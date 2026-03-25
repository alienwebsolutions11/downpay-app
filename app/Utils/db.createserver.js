import mysql from "mysql";

const con = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "downpay",
});

con.connect((err) => {
  if (err) {
    console.error("DB connection failed:", err);
  } else {
    console.log("MySQL connected");

    // ✅ ADD THIS
    con.query("SELECT DATABASE()", (err, res) => {
      if (err) {
        console.error("DB name check failed:", err);
      } else {
        console.log("CONNECTED DATABASE:", res[0]["DATABASE()"]);
      }
    });
  }
});

export default con;
// import mysql from "mysql";

// const pool = mysql.createPool({
//   host: "localhost",
//   user: "root",
//   password: "",
//   database: "downpay",
//   connectionLimit: 10,
//   waitForConnections: true,
//   queueLimit: 0,
// });

// // Optional: test once at startup
// pool.query("SELECT DATABASE()", (err, res) => {
//   if (err) {
//     console.error("DB connection failed:", err);
//   } else {
//     console.log("MySQL connected");
//     console.log("CONNECTED DATABASE:", res[0]["DATABASE()"]);
//   }
// });

// export default pool;
