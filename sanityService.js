const axios = require("axios");
const { Client } = require("pg");
const express = require("express");
const bodyParser = require("body-parser");
const { v4: uuidv4 } = require("uuid");

// Database client for connecting to PostgreSQL
const client = new Client({
  host: "localhost",
  port: 5432,
  user: "your_db_user",
  password: "your_db_password",
  database: "sanity_results_db",
});

// Connect to the PostgreSQL database
client.connect();

// Express app setup
const app = express();
app.use(bodyParser.json());

// Function to validate database credentials
async function validateDatabaseCredentials(dbConfig) {
  const testClient = new Client(dbConfig);
  try {
    await testClient.connect();
    await testClient.query("SELECT 1"); // Simple query to check connection
    await testClient.end();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Define the tests you want to perform
const tests = [
  {
    description: "Check if PGMaker2 API is reachable",
    url: "https://pgmaker.example.com/health",
    method: "GET",
    expectedStatusCode: 200,
  },
  {
    description: "Check if API returns valid database credentials",
    url: "https://pgmaker.example.com/db-credentials",
    method: "GET",
    expectedStatusCode: 200,
    validateResponse: async (data) => {
      // Data should contain db connection parameters like host, user, password, database
      if (data && data.host && data.user && data.password && data.database) {
        const dbResult = await validateDatabaseCredentials({
          host: data.host,
          port: data.port || 5432,
          user: data.user,
          password: data.password,
          database: data.database,
        });
        return dbResult.success
          ? { success: true }
          : { success: false, error: dbResult.error };
      }
      return { success: false, error: "Invalid database credentials format" };
    },
  },
];

// Run tests sequentially and store results in the PostgreSQL database
const runTests = async () => {
  const runId = uuidv4(); // Generate a unique ID for this test run
  const testReport = [];

  for (const test of tests) {
    const reportEntry = { run_id: runId, description: test.description };
    try {
      const response = await axios({
        method: test.method,
        url: test.url,
      });

      // Check the response status code
      if (response.status !== test.expectedStatusCode) {
        reportEntry.result = "Fail";
        reportEntry.error = `Expected status ${test.expectedStatusCode}, but got ${response.status}`;
      } else if (test.validateResponse) {
        // Validate the response if a validation function is provided
        const validationResult = await test.validateResponse(response.data);
        reportEntry.result = validationResult.success ? "Pass" : "Fail";
        if (!validationResult.success) {
          reportEntry.error = validationResult.error;
        }
      } else {
        reportEntry.result = "Pass";
      }
    } catch (error) {
      reportEntry.result = "Fail";
      reportEntry.error = error.message;
    }
    // Add the result to the report and save it to the database
    testReport.push(reportEntry);
    await saveTestResultToDB(reportEntry);
  }

  return { run_id: runId, report: testReport };
};

// Function to save test results to the PostgreSQL database
const saveTestResultToDB = async (entry) => {
  const query = `
    INSERT INTO sanity_tests(run_id, description, result, error)
    VALUES($1, $2, $3, $4)
  `;
  const values = [
    entry.run_id,
    entry.description,
    entry.result,
    entry.error || null,
  ];
  await client.query(query, values);
};

// Endpoint to run the sanity tests and return the report
app.get("/run-tests", async (req, res) => {
  const result = await runTests();
  res.json(result);
});

// Endpoint to get the results of a specific test run based on the unique ID
app.get("/results/:run_id", async (req, res) => {
  const runId = req.params.run_id;
  const query = `SELECT * FROM sanity_tests WHERE run_id = $1`;
  const values = [runId];

  try {
    const result = await client.query(query, values);
    if (result.rows.length > 0) {
      res.json(result.rows);
    } else {
      res.status(404).json({ message: "No results found for this run ID" });
    }
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching results", error: error.message });
  }
});

// Start the Express server
app.listen(3000, () => {
  console.log("Sanity service running on port 3000");
});
