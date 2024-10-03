const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: 8080 });
const fs = require("fs");
const h2hPath = "./h2h_stats.json";
const statPath = "stats.json";

let clients = []; // List of all connected clients
let availablePlayers = []; // List of players who are not in a game

// Load stats from file
function loadStats() {
  if (fs.existsSync(statPath)) {
    const data = fs.readFileSync(statPath);
    return JSON.parse(data);
  }
  return {};
}

// Load stats from file
function loadHeadToHeadStats() {
  if (fs.existsSync(h2hPath)) {
    const data = fs.readFileSync(h2hPath);
    return JSON.parse(data);
  }
  return {};
}

// Save stats to file
function saveStats(stats) {
  console.log("saving stats");
  fs.writeFileSync(statPath, JSON.stringify(stats, null, 2));
}

function saveHeadToHeadStats(stats) {
  console.log("saving h2h stats");
  fs.writeFileSync(h2hPath, JSON.stringify(stats, null, 2));
}

// Initialize stats if the file doesn't exist
let playerStats = loadStats();
let headToHeadStats = loadHeadToHeadStats();

wss.on("connection", (ws) => {
  ws.username = null;
  ws.inGame = false;

  ws.currentMove = null; // Track each player's move

  clients.push(ws); // Add all connected players to clients list

  console.log("New client connected.");

  ws.send(JSON.stringify({ type: "connected" }));

  ws.on("message", (message) => {
    const data = JSON.parse(message);

    // Log incoming message data
    console.log("Received message:", data);

    if (data.type === "setUsername") {
      const existingClient = clients.find(
        (client) => client.username === data.username
      );

      if (existingClient) {
        // Notify the client and close the connection
        console.log(
          `Username "${data.username}" is already taken by another client.`
        );
        ws.send(
          JSON.stringify({
            type: "usernameTaken",
            message: "Username is already taken. Please choose another.",
          })
        );
        ws.close(); // Disconnect the client
      } else {
        ws.username = data.username;
        console.log(`Username set: ${ws.username}`);
        ws.send(
          JSON.stringify({
            type: "playerStats",
            playerStats: getStatsForPlayer(data.username),
          })
        );
        console.log(getStatsForPlayer(data.username));
        availablePlayers.push(ws);
        broadcastAvailablePlayers();
      }
    }

    if (data.type === "challengePlayer") {
      const opponent = findPlayerByUsername(data.opponentUsername);
      if (opponent && !opponent.inGame) {
        const headToHeadStats = getHeadToHeadStats(
          ws.username,
          opponent.username
        );

        console.log(`${ws.username} is challenging ${opponent.username}`);
        ws.send(
          JSON.stringify({
            type: "gameStart",
            opponent: opponent.username,
            headToHeadStats: headToHeadStats, // Include head-to-head stats
          })
        );
        opponent.send(
          JSON.stringify({
            type: "gameStart",
            opponent: ws.username,
            headToHeadStats: headToHeadStats, // Include head-to-head stats
          })
        );
      } else {
        console.log(
          `Challenge failed: ${data.opponentUsername} is already in a game, not found, or there's an issue.`
        );
      }
    }

    if (data.type === "acceptChallenge") {
      const challenger = findPlayerByUsername(data.challenger);
      if (challenger && !challenger.inGame) {
        console.log(
          `${ws.username} accepted challenge from ${challenger.username}`
        );
        ws.inGame = true;
        challenger.inGame = true;
        removePlayerFromAvailable(ws);
        removePlayerFromAvailable(challenger);

        // Notify both players to start the game
        ws.send(
          JSON.stringify({ type: "gameStart", opponent: challenger.username })
        );
        challenger.send(
          JSON.stringify({ type: "gameStart", opponent: ws.username })
        );
      } else {
        console.log(
          `Challenge acceptance failed: ${data.challenger} not available.`
        );
      }
    }

    if (data.type === "makeMove") {
      const opponent = findPlayerByUsername(data.opponent);

      if (opponent) {
        ws.currentMove = data.move; // Store the current player's move
        console.log(
          `${ws.username} made move: ${data.move} against ${opponent.username}`
        );

        if (opponent.currentMove) {
          console.log(
            `Both players have made their move: ${ws.username} (${ws.currentMove}) vs ${opponent.username} (${opponent.currentMove})`
          );
          const result = determineWinner(ws.currentMove, opponent.currentMove);

          console.log(result);

          // Update stats based on the result
          if (result[0] === "win") {
            updateStats(ws.username, opponent.username); // ws is the winner
          } else if (result[0] === "lose") {
            updateStats(opponent.username, ws.username); // opponent is the winner
          } else if (result[0] === "draw") {
            updateStats(ws.username, opponent.username, true); // It's a draw
          }
          // Update head-to-head stats based on the result
          if (result[0] === "win") {
            updateHeadToHeadStats(ws.username, opponent.username); // ws is the winner
          } else if (result[0] === "lose") {
            updateHeadToHeadStats(opponent.username, ws.username); // opponent is the winner
          } else if (result[0] === "draw") {
            updateHeadToHeadStats(ws.username, opponent.username, true); // It's a draw
          }

          // Send result to both players
          ws.send(
            JSON.stringify({
              type: "gameResult",
              result: result[0],
              opponentMove: opponent.currentMove,
            })
          );
          opponent.send(
            JSON.stringify({
              type: "gameResult",
              result: result[1],
              opponentMove: ws.currentMove,
            })
          );

          // Reset moves for both players
          ws.currentMove = null;
          opponent.currentMove = null;
        } else {
          console.log(
            `Waiting for opponent ${opponent.username} to make a move.`
          );
        }
      } else {
        console.log(
          `Error: Opponent not found for ${ws.username}. Opponent username: ${data.opponent}`
        );
      }
    }

    if (data.type === "exitMatch") {
      const opponent = findPlayerByUsername(data.opponent);

      if (opponent && opponent.inGame) {
        opponent.send(
          JSON.stringify({
            type: "opponentLeft",
          })
        );
        const opponent = null;
      } else {
        console.log(`Error: Opponent not found or not in game for rematch.`);
      }
    }

    if (data.type === "requestRematch") {
      const opponent = findPlayerByUsername(data.opponent);

      if (opponent && opponent.inGame) {
        console.log(
          `${ws.username} requested a rematch with ${opponent.username}`
        );

        // Reset game state for both players
        ws.currentMove = null;
        opponent.currentMove = null;

        const headToHeadStats = getHeadToHeadStats(
          ws.username,
          opponent.username
        );

        // Notify both players to start a new game
        ws.send(
          JSON.stringify({
            type: "gameStart",
            opponent: opponent.username,
            headToHeadStats: headToHeadStats, // Include head-to-head stats
          })
        );
        opponent.send(
          JSON.stringify({
            type: "gameStart",
            opponent: ws.username,
            headToHeadStats: headToHeadStats, // Include head-to-head stats
          })
        );

        console.log(
          `Rematch started between ${ws.username} and ${opponent.username}`
        );
      } else {
        console.log(`Error: Opponent not found or not in game for rematch.`);
      }
    }
  });

  ws.on("close", () => {
    console.log(`${ws.username || "Unknown client"} disconnected.`);
    removePlayerFromAvailable(ws);
    clients = clients.filter((client) => client !== ws); // Ensure client is removed on disconnect
    broadcastAvailablePlayers();
  });
});

// Helper function to find player by username in clients list
function findPlayerByUsername(username) {
  const player = clients.find((client) => client.username === username); // Now search in clients

  if (player) {
    console.log(`Found player: ${username}`);
  } else {
    console.log(`Player not found: ${username}`);
  }

  return player;
}

// Helper function to remove a player from the available list
function removePlayerFromAvailable(player) {
  availablePlayers = availablePlayers.filter((p) => p !== player);
  console.log(`Player ${player.username} removed from available players.`);
}

// Broadcast the list of available players
function broadcastAvailablePlayers() {
  const playerList = availablePlayers.map((player) => player.username);
  console.log("Broadcasting available players:", playerList);
  availablePlayers.forEach((player) => {
    player.send(
      JSON.stringify({ type: "availablePlayers", players: playerList })
    );
  });
}

function determineWinner(move1, move2) {
  if (move1 === move2) return ["draw", "draw"];

  if (
    (move1 === "rock" && move2 === "scissors") ||
    (move1 === "scissors" && move2 === "paper") ||
    (move1 === "paper" && move2 === "rock")
  ) {
    return ["win", "lose"];
  } else {
    return ["lose", "win"];
  }
}

function getStatsForPlayer(username) {
  // This function retrieves the stats for a player (from memory or persistent storage)
  return (
    playerStats[username] || { wins: 0, losses: 0, draws: 0, gamesPlayed: 0 }
  );
}

// Function to update player stats
function updateStats(winner, loser, isDraw = false) {
  if (isDraw) {
    // For a draw, update both players' draws and gamesPlayed
    if (!playerStats[winner]) {
      playerStats[winner] = { wins: 0, losses: 0, draws: 0, gamesPlayed: 0 };
    }
    if (!playerStats[loser]) {
      playerStats[loser] = { wins: 0, losses: 0, draws: 0, gamesPlayed: 0 };
    }

    // Update both players' stats for a draw
    playerStats[winner].draws += 1;
    playerStats[loser].draws += 1;
    playerStats[winner].gamesPlayed += 1;
    playerStats[loser].gamesPlayed += 1;
  } else {
    // For a win/loss, update winner's wins and loser's losses
    if (!playerStats[winner]) {
      playerStats[winner] = { wins: 0, losses: 0, draws: 0, gamesPlayed: 0 };
    }
    if (!playerStats[loser]) {
      playerStats[loser] = { wins: 0, losses: 0, draws: 0, gamesPlayed: 0 };
    }

    // Update winner and loser stats
    playerStats[winner].wins += 1;
    playerStats[loser].losses += 1;
    playerStats[winner].gamesPlayed += 1;
    playerStats[loser].gamesPlayed += 1;
  }

  // Save the updated stats to the file (or database)
  saveStats(playerStats);
}

// Function to get the stats key for two players
function getHeadToHeadKey(player1, player2) {
  // Generate a unique key for the pair of players (alphabetical order to avoid duplication)
  const sortedPlayers = [player1, player2].sort();
  return `${sortedPlayers[0]}_vs_${sortedPlayers[1]}`;
}

// Function to update head-to-head stats between two players
function updateHeadToHeadStats(winner, loser, isDraw = false) {
  const key = getHeadToHeadKey(winner, loser);

  if (!headToHeadStats[key]) {
    headToHeadStats[key] = { wins: 0, losses: 0, draws: 0, gamesPlayed: 0 };
  }

  // Update head-to-head stats
  if (isDraw) {
    headToHeadStats[key].draws += 1;
  } else {
    headToHeadStats[key].wins += 1; // This represents wins for player1
    headToHeadStats[key].losses += 1; // This represents losses for player2
  }

  headToHeadStats[key].gamesPlayed += 1;

  // Save the updated stats (if using persistent storage)
  saveHeadToHeadStats(headToHeadStats);
}

// Send head-to-head stats to players when a game starts
function getHeadToHeadStats(player1, player2) {
  const key = getHeadToHeadKey(player1, player2);
  return (
    headToHeadStats[key] || { wins: 0, losses: 0, draws: 0, gamesPlayed: 0 }
  );
}

console.log("WebSocket server is running on ws://localhost:8080");
