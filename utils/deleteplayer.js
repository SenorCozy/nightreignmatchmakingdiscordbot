function deletePlayer(playerId) {
  return new Promise(async (resolve, reject) => {
    try {
      // Step 1: Remove from `players`
      await new Promise((res, rej) => {
        db.run(`DELETE FROM players WHERE id = ?`, [playerId], (err) =>
          err ? rej(err) : res()
        );
      });

      // Step 2: Mark `match_players` as removed
      await new Promise((res, rej) => {
        db.run(
          `UPDATE match_players SET status = 'removed' WHERE playerId = ?`,
          [playerId],
          (err) => (err ? rej(err) : res())
        );
      });

      console.info(`✅ Player ${playerId} fully reset from the database.`);
      resolve();
    } catch (err) {
      console.error(
        `❌ Error during player reset for ${playerId}:`,
        err.message
      );
      reject(err);
    }
  });
}
