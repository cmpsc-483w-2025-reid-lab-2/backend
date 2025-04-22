const express = require("express");
const router = express.Router();
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const connection = require("./db-connection");

// Set up multer for file upload
const upload = multer({ dest: "uploads/" });

const readline = require("readline");

function parseMantisCsv(filePath) {
  return new Promise((resolve, reject) => {
    const outputRows = [];

    const input = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input });

    const tempPath = `${filePath}-cleaned.csv`;
    const tempStream = fs.createWriteStream(tempPath);

    let lineCount = 0;
    rl.on("line", (line) => {
      if (lineCount >= 5) tempStream.write(line + "\n");
      lineCount++;
    });

    rl.on("close", () => {
      tempStream.end();

      // Now re-parse just the valid part
      fs.createReadStream(tempPath)
        .pipe(csv())
        .on("data", (row) => {
          if (row["ID"] && row["Score"]) {
            outputRows.push(row);
          }
        })
        .on("end", () => {
          fs.unlink(tempPath, () => {}); // cleanup temp
          resolve(outputRows);  
        })
        .on("error", reject);
    });
  });
}

function parseHeartRateCsv(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => {
        // Expecting headers: time_started,user_id,avg_rate,max_rate,min_rate
        if (row["time_started"] && row["user_id"] && row["avg_rate"]) {
          results.push(row);
        }
      })
      .on("end", () => {
        resolve(results);
      })
      .on("error", reject);
  });
}

// =======================
// ROUTES
// =======================

// GET all users
router.get("/users", (req, res) => {
  connection.query("SELECT * FROM users", (err, results) => {
    if (err) {
      return res.status(500).send(err);
    }
    res.json(results);
  });
});

// POST a new user
router.post("/users", (req, res) => {
  const user = req.body;
  connection.query("INSERT INTO users SET ?", user, (err, results) => {
    if (err) {
      return res.status(500).send(err);
    }
    res.status(201).send(results);
  });
});

// POST route to upload Mantis Sessions CSV file
router.post("/upload", upload.single("mantisFile"), async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: "MANTIS CSV file is required." });
  }

  try {
    const sessions = await parseMantisCsv(file.path);
    if (sessions.length === 0) {
      return res.status(400).json({ error: "No valid session data found." });
    }

    // Flush existing sessions
    await connection.promise().query("SET FOREIGN_KEY_CHECKS = 0");
    await connection.promise().query("TRUNCATE TABLE mantis_data_sessions");
    await connection.promise().query("SET FOREIGN_KEY_CHECKS = 1");

    // Insert all sessions
    for (const row of sessions) {
      const newSession = {
        session_id: parseInt(row["ID"]),
        user_id: 1, // TEMP
        total_shots: parseInt(row["Shot Count"]) || 0,
        avg_score: parseFloat(row["Score"]) || 0,
        time_started: new Date(row["Date"]),  // <-- this works fine with UTC string!
        session_length: new Date(1000 * 60 * 5), // Placeholder: 5 minutes
      };
      

      await connection.promise().query("INSERT INTO mantis_data_sessions SET ?", newSession);
    }

    fs.unlink(file.path, () => {}); // Clean up temp file

    res.json({
      message: `Uploaded ${sessions.length} MANTIS session(s) successfully.`,
    });

  } catch (err) {
    console.error("CSV processing error:", err);
    res.status(500).json({ error: "Failed to process MANTIS session CSV." });
  }
});

// GET route for sanity checking route is good
router.get("/upload/heart-rate", (req, res) => {
  res.send("Backend route is alive!");
});

// POST route to upload heart rate CSV.
// Endpoint for Kotlin/WearOS app to upload heart rate CSV
router.post("/upload/heart-rate", upload.single("heartRateFile"), async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: "Heart rate CSV file is required." });
  }

  try {
    const heartData = await parseHeartRateCsv(file.path);
    if (heartData.length === 0) {
      return res.status(400).json({ error: "No valid heart rate data found." });
    }

    // Get the most recent session_id from mantis_data_sessions
    const [rows] = await connection.promise().query(
      "SELECT session_id FROM mantis_data_sessions ORDER BY session_id DESC LIMIT 1"
    );
    const latestSessionId = rows[0]?.session_id;

    if (!latestSessionId) {
      return res.status(400).json({ error: "No MANTIS session found to link heart rate." });
    }

    const values = heartData.map(entry => ({
      session_id: latestSessionId,
      user_id: entry.user_id || 1,
      time_started: entry.time_started,
      avg_rate: entry.avg_rate,
      max_rate: entry.max_rate,
      min_rate: entry.min_rate,
    }));

    // Insert each row
    for (const row of values) {
      await connection.promise().query("INSERT INTO heart_data SET ?", row);
    }

    fs.unlink(file.path, () => {});
    res.json({ message: "Heart rate data uploaded and linked to latest session." });
  } catch (err) {
    console.error("Heart rate CSV processing error:", err);
    res.status(500).json({ error: "Server failed to process heart rate CSV." });
  }
});


router.get("/performance-by-day", async (req, res) => {
  try {
    const query = `
      SELECT 
        DAYNAME(time_started) AS day,
        ROUND(AVG(avg_score), 1) AS score
      FROM mantis_data_sessions
      GROUP BY DAYOFWEEK(time_started), day
      ORDER BY DAYOFWEEK(time_started)`;

    const [rows] = await connection.query(query);

    const formattedData = rows.map(row => ({
      day: row.day.substring(0, 3),
      score: row.score
    }));

    res.status(200).json(formattedData);
  } catch (err) {
    console.error("Performance by day error:", err);
    res.status(500).json({ error: 'Failed to get performance data' });
  }
});

// GET heart rate correlation
router.get("/heart-rate-correlation", async (req, res) => {
  try {
    const query = `
      SELECT 
        CASE
          WHEN hr.avg_rate BETWEEN 100 AND 109 THEN '100-110'
          WHEN hr.avg_rate BETWEEN 110 AND 119 THEN '110-120'
          WHEN hr.avg_rate BETWEEN 120 AND 129 THEN '120-130'
          WHEN hr.avg_rate BETWEEN 130 AND 139 THEN '130-140'
          WHEN hr.avg_rate BETWEEN 140 AND 149 THEN '140-150'
          WHEN hr.avg_rate BETWEEN 150 AND 159 THEN '150-160'
          ELSE '160+'
        END AS heartRate,
        ROUND(AVG(m.avg_score), 1) AS score
      FROM (
        SELECT 
          session_id,
          AVG(avg_rate) AS avg_rate
        FROM heart_data
        GROUP BY session_id
      ) hr
      JOIN mantis_data_sessions m ON hr.session_id = m.session_id
      GROUP BY heartRate
      ORDER BY heartRate`;

    const [rows] = await connection.query(query);
    res.status(200).json(rows);
  } catch (err) {
    console.error("Heart rate correlation error:", err);
    res.status(500).json({ error: 'Failed to get heart rate correlation data' });
  }
});

module.exports = router;