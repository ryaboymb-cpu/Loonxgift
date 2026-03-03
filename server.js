const express = require("express");
const app = express();
	const { getCrashMultiplier } = require("./crash");

app.use(express.json());
app.use(express.static("public"));

let currentGame = {
  multiplier: 1,
  active: false
};

function startGame() {
  currentGame.active = true;
  currentGame.multiplier = getCrashMultiplier();

  setTimeout(() => {
    currentGame.active = false;
  }, 5000);
}

setInterval(startGame, 10000);

app.get("/game", (req, res) => {
  res.json(currentGame);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("LoonxGift server started on port " + PORT);
});
