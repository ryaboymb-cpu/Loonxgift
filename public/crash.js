function getCrashMultiplier() {
  const rand = Math.random() * 100;

  // 6% — проигрыш (1x)
  if (rand < 6) {
    return 1.0;
  }

  // 1 из 160 игр — 50x
  if (Math.floor(Math.random() * 160) === 0) {
    return 50.0;
  }

  // 70% — от 2x до 6x
  if (rand < 76) {
    return (Math.random() * 4 + 2).toFixed(2);
  }

  // Остальные — от 1.01x до 2x
  return (Math.random() + 1).toFixed(2);
}

module.exports = { getCrashMultiplier };
