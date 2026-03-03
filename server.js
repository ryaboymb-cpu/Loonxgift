const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Проверка сервера
app.get("/api/test", (req, res) => {
  res.json({ status: "Server working ✅" });
});

// Получить адрес кошелька
app.get("/api/wallet", (req, res) => {
  res.json({
    wallet: process.env.WALLET_ADDRESS || "Wallet not set"
  });
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
