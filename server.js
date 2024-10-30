const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: 8080 });
const fs = require("fs");
dataFilePath = "data.json";

let clients = []; // List of all connected clients
let ongoingGames = {}; // Store game data for each ongoing game
let matchQueue = []; // To store users looking for a match

// Load stats from file
function loadData() {
  if (fs.existsSync(dataFilePath)) {
    const rawData = fs.readFileSync(dataFilePath);
    return JSON.parse(rawData);
  }
  return { users: {}, games: {} };
}

function saveData(data) {
  const jsonData = JSON.stringify(data, null, 2);
  fs.writeFileSync(dataFilePath, jsonData);
}

function generateGameId(player1, player2) {
  // Sort the usernames alphabetically to ensure the gameId is consistent
  return [player1, player2].sort().join("_");
}

function getUser(username) {
  const data = fs.readFileSync("data.json");
  const users = JSON.parse(data).users;
  if (users && users[username]) {
    return users[username];
  }
  return undefined;
}

function gatherGameData(player1Id, player2Id) {
  const gameData = {
    timestamp: new Date().toISOString(), // Current timestamp
    players: {
      [player1Id]: { result: "", wins: 0, moves: [] },
      [player2Id]: { result: "", wins: 0, moves: [] },
    },
    rounds: [],
  };

  let roundNumber = 0;
  let gameOver = false;

  // Helper function to determine the winner of a round
  function determineRoundWinner(playerMove1, playerMove2) {
    if (playerMove1.move === playerMove2.move) return null; // It's a tie
    if (
      (playerMove1.move === "rock" && playerMove2.move === "scissors") ||
      (playerMove1.move === "scissors" && playerMove2.move === "paper") ||
      (playerMove1.move === "paper" && playerMove2.move === "rock")
    ) {
      return playerMove1.username;
    } else {
      return playerMove2.username;
    }
  }

  // Play a round and record it
  function playRound(playerMove1, playerMove2) {
    if (gameOver) {
      console.log("The game is already over.");
      return;
    }

    roundNumber += 1;
    const roundWinner = determineRoundWinner(playerMove1, playerMove2);

    // Update player moves
    gameData.players[player1Id].moves.push(
      playerMove1.player === player1Id ? playerMove1.move : playerMove2.move
    );
    gameData.players[player2Id].moves.push(
      playerMove2.player === player2Id ? playerMove2.move : playerMove1.move
    );

    // Record the round
    const roundData = {
      roundNumber,
      moves: {
        [player1Id]:
          playerMove1.player === player1Id
            ? playerMove1.move
            : playerMove2.move,
        [player2Id]:
          playerMove2.player === player2Id
            ? playerMove2.move
            : playerMove1.move,
      },
      winner: roundWinner,
    };

    gameData.rounds.push(roundData);

    // Update wins if there's a round winner
    if (roundWinner) {
      console.log(`Round ${roundNumber} winner: ${roundWinner}`);
      gameData.players[roundWinner].wins += 1;
    }
    console.log(gameData.players);

    // Check if the game is over
    if (gameData.players[player1Id].wins === 3) {
      gameData.players[player1Id].result = "win";
      gameData.players[player2Id].result = "loss";
      gameOver = true;
    } else if (gameData.players[player2Id].wins === 3) {
      gameData.players[player2Id].result = "win";
      gameData.players[player1Id].result = "loss";
      gameOver = true;
    }
  }

  // Return the game data once the game is over
  function endGame() {
    if (!gameOver) {
      console.log("The game isn't over yet.");
      return null;
    }
    return gameData;
  }

  // The returned object contains the methods to play rounds and end the game
  return {
    playRound,
    endGame,
  };
}

function getUserFriends(userId) {
  const data = loadData();
  const user = data.users[userId];

  if (!user) {
    return `User ${userId} not found.`;
  }

  return user.friends;
}

// Function to calculate stats for a specific player from their played games
function calculateStats(playerName, gamesPlayed, data) {
  const games = data.games;
  const stats = {
    totalGames: 0,
    totalWins: 0,
    totalLosses: 0,
    moves: {
      rock: { roundsPlayed: 0, wins: 0, losses: 0 },
      paper: { roundsPlayed: 0, wins: 0, losses: 0 },
      scissors: { roundsPlayed: 0, wins: 0, losses: 0 },
    },
    totalRoundsPlayed: 0,
    winRate: 0,
    mostPlayedMove: null,
    averageRoundsPerGame: 0,
  };

  // Iterate through the user's played games
  gamesPlayed.forEach((gameId) => {
    const game = games[gameId];

    // Skip if game doesn't exist or if player didn't participate
    if (!game || !game.players[playerName]) return;

    const playerData = game.players[playerName];
    stats.totalGames++;
    stats.totalRoundsPlayed += game.rounds.length;

    if (playerData.result === "win") {
      stats.totalWins++;
    } else {
      stats.totalLosses++;
    }

    // Count moves and their outcomes
    playerData.moves.forEach((move, index) => {
      if (stats.moves[move]) {
        stats.moves[move].roundsPlayed++;

        // Check if this move was a win or loss in the round
        if (game.rounds[index].winner === playerName) {
          stats.moves[move].wins++;
        } else {
          stats.moves[move].losses++;
        }
      }
    });
  });

  // Calculate additional statistics
  if (stats.totalGames > 0) {
    stats.winRate = ((stats.totalWins / stats.totalGames) * 100).toFixed(2);

    // Determine most frequently used move
    let mostPlayedMove = null;
    let mostPlayedCount = 0;
    for (const move in stats.moves) {
      const moveRounds = stats.moves[move].roundsPlayed;
      if (moveRounds > mostPlayedCount) {
        mostPlayedMove = move;
        mostPlayedCount = moveRounds;
      }
    }

    stats.mostPlayedMove = mostPlayedMove;
    stats.averageRoundsPerGame = (
      stats.totalRoundsPlayed / stats.totalGames
    ).toFixed(2);
  }

  return stats;
}

// Function to calculate user stats
function getUserStats(userId) {
  const data = loadData();
  const user = data.users[userId];

  if (!user) {
    return `User ${userId} not found.`;
  }

  const totalStats = calculateStats(userId, user.gamesPlayed, data);

  // Create an object to hold stats for total and each friend
  const statsByFriend = { total: totalStats };

  // Calculate stats versus each friend
  user.friends.forEach((friend) => {
    const friendGames = user.gamesPlayed.filter(
      (gameId) => data.games[gameId] && data.games[gameId].players[friend]
    );

    const friendStats = calculateStats(userId, friendGames, data);
    statsByFriend[friend] = friendStats;
  });

  return statsByFriend;
}

function addUser(userId) {
  const data = loadData();
  if (!data.users[userId]) {
    data.users[userId] = { gamesPlayed: [], friends: [] };
  }
  saveData(data);
}

function addGame(gameId, gameData, playerIds) {
  const data = loadData();

  // Save game data
  data.games[gameId] = gameData;

  // Update users with the new game
  playerIds.forEach((playerId) => {
    if (!data.users[playerId]) {
      addUser(playerId); // Ensure the user exists
    }
    data.users[playerId].gamesPlayed.push(gameId);
  });

  saveData(data);
}

// function calculateStats(username, data) {
//   const user = data.users[username];
//   const gamesPlayed = user.gamesPlayed;

//   let totalGames = 0;
//   let totalWins = 0;
//   let totalRounds = 0;
//   let roundWins = 0;

//   gamesPlayed.forEach((gameId) => {
//     const game = data.games[gameId];
//     const userGameInfo = game.players[username];
//     const opponentId = Object.keys(game.players).find((id) => id !== username);

//     // Track game wins/losses
//     totalGames += 1;
//     if (userGameInfo.result === "win") totalWins++;

//     // Track games per friend
//     if (!gamesByFriend[opponentId]) {
//       gamesByFriend[opponentId] = { games: 0, wins: 0 };
//     }
//     gamesByFriend[opponentId].games += 1;
//     if (userGameInfo.result === "win") gamesByFriend[opponentId].wins += 1;

//     // Round-level analysis
//     game.rounds.forEach((round) => {
//       totalRounds += 1;
//       const move = round.moves[username];
//       movesStats[move].games += 1;
//       if (round.winner === username) roundWins += 1;
//     });
//   });

//   const gameWinrate = (totalWins / totalGames) * 100;
//   const roundWinrate = (roundWins / totalRounds) * 100;

//   return {
//     totalGames,
//     totalRounds,
//     gameWinrate,
//     roundWinrate,
//     gamesByFriend,
//     movesStats,
//   };
// }

wss.on("connection", (ws) => {
  ws.username = null;
  ws.inGame = false;
  ws.currentMove = null;
  clients.push(ws);
  console.log("New client connected.");
  ws.send(JSON.stringify({ type: "connected" }));

  ws.on("message", (message) => {
    const data = JSON.parse(message);
    console.log("Received message:", data);

    // HANDLE SET USERNAME
    if (data.type === "setUsername") {
      // Check if the username is already taken
      if (clients.find((client) => client.username === data.username)) {
        console.log(
          `Username "${data.username}" is already taken by another client.`
        );
        ws.send(
          JSON.stringify({
            type: "usernameTaken",
            message: "Username is already taken. Please choose another.",
          })
        );
      } else {
        // Add the user to db if it doesn't exist
        if (getUser(data.username) === undefined) {
          addUser(data.username);
        }
        ws.username = data.username;
        console.log(`Username set: ${ws.username}`);
        ws.send(
          JSON.stringify({
            type: "loggedIn",
            username: ws.username,
            friends: getUserFriends(data.username),
            playerStats: getUserStats(data.username),
          })
        );
      }
    }

    if (data.type === "findMatch") {
      if (matchQueue.length > 0) {
        const opponent = matchQueue.shift(); // Get the first user from the queue
        console.log(`${ws.username} is matched with ${opponent.username}`);

        let gameId = generateGameId(ws.username, opponent.username);

        // Notify both players that they have been matched
        ws.send(
          JSON.stringify({
            type: "matchFound",
            opponent: opponent.username,
            gameId: gameId,
            message:
              "You have been matched with an opponent! The game is starting.",
          })
        );
        opponent.send(
          JSON.stringify({
            type: "matchFound",
            opponent: ws.username,
            gameId: gameId,
            message:
              "You have been matched with an opponent! The game is starting.",
          })
        );
      } else {
        // No user in the queue, add the current user to the matchQueue
        console.log(`${ws.username} is looking for a match...`);
        matchQueue.push(ws);

        ws.send(
          JSON.stringify({
            type: "waitingForMatch",
            message: "You are waiting for an opponent to be matched.",
          })
        );
      }
    }

    if (data.type === "acceptMatch") {
      const opponent = findPlayerByUsername(data.opponent);

      let gameId = data.gameId;

      // If the game already exists, it means the opponent has already accepted the match
      if (ongoingGames[gameId]) {
        ws.move = null;
        opponent.move = null;

        ws.inGame = true;
        opponent.inGame = true;

        ws.send(
          JSON.stringify({ type: "gameStart", opponent: opponent.username })
        );
        opponent.send(
          JSON.stringify({ type: "gameStart", opponent: ws.username })
        );
      } else {
        // Create a new game and add it to the ongoingGames
        ongoingGames[gameId] = gatherGameData(ws.username, opponent.username);
      }
    }

    if (data.type === "exitQueue") {
      const opponent = findPlayerByUsername(data.opponent);
      const gameId = data.gameId;

      delete ongoingGames[gameId];

      matchQueue = matchQueue.filter((player) => player !== ws);
      matchQueue = matchQueue.filter((player) => player !== opponent);

      ws.send(
        JSON.stringify({
          type: "exitedQueue",
          message: "You have exited the queue.",
        })
      );

      if (opponent) {
        opponent.send(
          JSON.stringify({
            type: "exitedQueue",
            message: "Your opponent has exited the queue.",
          })
        );
        console.log(`${ws.username} has exited the queue.`);
      }
    }

    // Function to handle player moves
    if (data.type === "makeMove") {
      const opponent = findPlayerByUsername(data.opponent);
      const gameId = data.gameId;

      if (opponent) {
        ws.currentMove = data.move; // Store the current player's move
        console.log(
          `${ws.username} made move: ${data.move} against ${opponent.username}`
        );

        // Generate a consistent game ID using sorted player usernames

        // Check if the game already exists in the ongoingGames
        if (!ongoingGames[gameId]) {
          console.log(
            `Error: No ongoing game found between ${ws.username} and ${opponent.username}`
          );
          return;
        }

        const game = ongoingGames[gameId];

        // Check if the opponent has already made their move
        if (opponent.currentMove) {
          // Both players have made their move
          console.log(
            `Both players have made their move: ${ws.username} (${ws.currentMove}) vs ${opponent.username} (${opponent.currentMove})`
          );

          // Determine the round winner
          const result = determineWinner(ws.currentMove, opponent.currentMove);

          // Play a round in the game
          game.playRound(
            { username: ws.username, move: ws.currentMove },
            { username: opponent.username, move: opponent.currentMove }
          );

          // Send the result of the current round to both players
          ws.send(
            JSON.stringify({
              type: "roundResult",
              result: result[0], // "win", "lose", or "draw" for ws
              opponentMove: opponent.currentMove,
              message: `You played ${ws.currentMove}, opponent played ${opponent.currentMove}, result: ${result[0]}`,
            })
          );
          opponent.send(
            JSON.stringify({
              type: "roundResult",
              result: result[1], // "win", "lose", or "draw" for opponent
              opponentMove: ws.currentMove,
              message: `You played ${opponent.currentMove}, opponent played ${ws.currentMove}, result: ${result[1]}`,
            })
          );

          // Reset moves for both players after the round
          ws.currentMove = null;
          opponent.currentMove = null;

          // Check if the game is over (one player has won 3 rounds)
          const finalGameData = game.endGame(); // This will be null if the game isn't over

          if (finalGameData) {
            console.log("Game over! Saving game data...");

            // Save the game data
            const newGameId = `game_${Date.now()}`;
            const playerIds = [ws.username, opponent.username];
            addGame(newGameId, finalGameData, playerIds);

            // Send the final result to both players
            ws.send(
              JSON.stringify({
                type: "gameResult",
                result: finalGameData.players[ws.username].result,
                message: `Game over! You ${
                  finalGameData.players[ws.username].result
                } against ${opponent.username}`,
              })
            );
            opponent.send(
              JSON.stringify({
                type: "gameResult",
                result: finalGameData.players[opponent.username].result,
                message: `Game over! You ${
                  finalGameData.players[opponent.username].result
                } against ${ws.username}`,
              })
            );

            // Clear the game from ongoingGames
            delete ongoingGames[gameId];
          }
        } else {
          // Waiting for the opponent to make a move
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

        // Notify both players to start a new game
        ws.send(
          JSON.stringify({
            type: "gameStart",
            opponent: opponent.username,
          })
        );
        opponent.send(
          JSON.stringify({
            type: "gameStart",
            opponent: ws.username,
          })
        );

        console.log(
          `Rematch started between ${ws.username} and ${opponent.username}`
        );
      } else {
        console.log(`Error: Opponent not found or not in game for rematch.`);
      }
    }

    if (data.type === "addFriend") {
      const d = loadData();
      const friend = data.friend;
      const user = getUser(ws.username);
      if (
        user.friends.includes(friend) ||
        d.users[friend] === undefined ||
        friend === ws.username ||
        friend === null
      ) {
        console.log("cannot be friends");
        ws.send(
          JSON.stringify({
            type: "friendError",
            message: `cannot be friends`,
          })
        );
      } else {
        user.friends.push(friend);
        d.users[ws.username].friends = user.friends;
        d.users[friend].friends.push(ws.username);
        saveData(d);
        console.log(`You are now friends with ${friend}`);
        ws.send(
          JSON.stringify({
            type: "friendAdded",
            friends: user.friends,
            message: `You are now friends with ${friend}`,
          })
        );
        if (clients.find((client) => client.username === friend)) {
          clients
            .find((client) => client.username === friend)
            .send(
              JSON.stringify({
                type: "friendAdded",
                friends: getUser(friend).friends,
                message: `You are now friends with ${friend}`,
              })
            );
        }
      }
    }
  });

  ws.on("close", () => {
    console.log(`${ws.username || "Unknown client"} disconnected.`);
    matchQueue = matchQueue.filter((player) => player !== ws);
    clients = clients.filter((client) => client !== ws); // Ensure client is removed on disconnect
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
console.log("WebSocket server is running on ws://localhost:8080");
