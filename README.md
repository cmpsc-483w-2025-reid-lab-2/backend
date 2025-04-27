# Threshold – Backend

This is the **backend server** for the **Threshold** project, built to help **law enforcement officers** track and improve their **performance and physiological readiness** during training exercises.

It is designed to:
- Collect **heart rate** and **accuracy (MANTIS system)** data
- **Store** the data securely in a **MySQL (AWS RDS)** database
- **Process and serve** data for visualization on the web dashboard
- **Handle uploads** directly from wearable devices (smartwatch app)

---

## Technologies Used

- **Node.js**
- **Express.js**
- **MySQL2**
- **Multer** (for handling CSV uploads)
- **Render** (for deployment)

---

## Project Structure

- **routes.js: Contains all API handlers. May be split into two route handlers for web-app and pixel watch for more readibility.**
- **db-connection.js: Contains the database connection setup.**
- **indes.js: Server entry point.**

 ---

 ## Purpose in the Full project

 The backend handles:
- **User Management**: Storing officer information.
- **Session Management**: Recording training sessions and heart rate data.
- **Data Uploads**: Allowing officers to upload session CSVs manually or via smartwatch app.
- **Graph Data**: Providing pre-aggregated performance data for frontend dashboards.
- **Secure Storage**: Using AWS RDS (MySQL) to persist important training data.

The frontend (website) and the smartwatch app **both interact with this backend**.

---

## Development Instructions

1. Inside the backend repository, first run **npm install**.
2. Set up a .env File with the following:
  - DB_HOST=your-db-endpoint
  - DB_USER=your-db-username
  - DB_PASSWORD=your-db-password
  - DB_DATABASE=your-db-name
3. If running backend locally on your localhost run: **node index.js**

## Render Deployment Instructions
1. On Render, **Create a new Web Service**
  - Connect your github repository.
  - Environment: **Node.js**
  - Build Command: **npm install**
  - Start Command: **node index.js**
2. Add the same environment variables on Render.
3. Whenever you push your repository, deployment happens automatically. But you can manually deploy the latest commit.
4. Use the backend URL Render gives you for your routing logic
