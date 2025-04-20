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

  console.log("📥 Received heart rate CSV upload");

  if (!file) {
    return res.status(400).json({ error: "CSV file is required." });
  }

  try {
    const results = [];

    fs.createReadStream(file.path)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => {
        if (results.length === 0) {
          return res.status(400).json({ error: "CSV is empty." });
        }

        const row = results[0]; // Expecting just one row

        const entry = {
          session_id: row.session_id,
          user_id: row.user_id,
          time_started: row.time_started,
          avg_rate: row.avg_rate,
          max_rate: row.max_rate,
          min_rate: row.min_rate,
        };

        connection.query("INSERT INTO heart_data SET ?", entry, (err) => {
          fs.unlink(file.path, () => {}); // cleanup file

          if (err) {
            console.error(err);
            return res.status(500).json({ error: "Database insert failed." });
          }

          res.json({ message: "Heart rate CSV uploaded and saved." });
        });
      })
      .on("error", (err) => {
        fs.unlink(file.path, () => {});
        console.error("CSV parse error:", err);
        res.status(500).json({ error: "Failed to parse CSV." });
      });
  } catch (err) {
    console.error("File upload error:", err);
    res.status(500).json({ error: "Server failed to process the CSV file." });
  }
});



module.exports = router;