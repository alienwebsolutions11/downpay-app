import pkg from "pg";

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Neon connection string
  ssl: {
    rejectUnauthorized: false, // required for Neon
  },
});

// Test connection
pool.connect()
  .then(async (client) => {
    console.log("✅ PostgreSQL connected");

    const res = await client.query("SELECT current_database()");
    console.log("CONNECTED DATABASE:", res.rows[0].current_database);

    client.release();
  })
  .catch((err) => {
    console.error("❌ DB connection failed:", err);
  });

export default pool;

// import mysql from "mysql";

// const con = mysql.createConnection({
//   host: "localhost",
//   user: "root",
//   password: "",
//   database: "downpay",
// });

// con.connect((err) => {
//   if (err) {
//     console.error("DB connection failed:", err);
//   } else {
//     console.log("MySQL connected");

//     // ✅ ADD THIS
//     con.query("SELECT DATABASE()", (err, res) => {
//       if (err) {
//         console.error("DB name check failed:", err);
//       } else {
//         console.log("CONNECTED DATABASE:", res[0]["DATABASE()"]);
//       }
//     });
//   }
// });

// export default con;
