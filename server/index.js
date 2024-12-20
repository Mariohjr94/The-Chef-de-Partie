import bodyParser from "body-parser";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import postRoutes from "./routes/posts.js";
import messagesRoutes from "./routes/messages.js";
import chatRoutes from "./routes/chats.js";

import { register } from "./controllers/auth.js";
import { createPost } from "./controllers/posts.js";
import { verifyToken } from "./middleware/auth.js";
import User from "./models/User.js";
import Post from "./models/Post.js";
import Chat from "./models/chat.js";
import Message from "./models/messages.js";

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

dotenv.config();

console.log("API Base URL:", process.env.REACT_APP_API_BASE_URL);
console.log("Socket URL:", process.env.REACT_APP_SOCKET_URL);
console.log("Frontend URL:", process.env.FRONTEND_URL);

const apiBaseUrl = process.env.REACT_APP_API_BASE_URL;
const socketUrl = process.env.REACT_APP_SOCKET_URL;
const frontendUrl = process.env.FRONTEND_URL;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(express.json());
app.use(helmet());
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
app.use(morgan("common"));
app.use(bodyParser.json({ limit: "30mb" }));
app.use(bodyParser.urlencoded({ limit: "30mb", extended: true }));
app.use(
  cors({
    origin: frontendUrl,
    methods: "GET,POST,PATCH,DELETE",
    credentials: true,
  })
);

app.use(
  "/assets",
  express.static(path.join(__dirname, "../client/public/assets"))
);

app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' https://the-chef-de-partie.onrender.com wss://the-chef-de-partie.onrender.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self' 'unsafe-inline';"
  );
  next();
});

// Serve static files from the React app
const buildPath = path.join(__dirname, "../client/dist");
app.use(express.static(buildPath));

// API routes
app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/posts", postRoutes);
app.use("/chats", chatRoutes);
app.use("/messages", messagesRoutes);

// Root Route
app.get("/", (req, res) => {
  res.sendFile(path.join(buildPath, "index.html"));
});

app.get("*", (req, res) => {
  res.sendFile(path.join(buildPath, "index.html"));
});

app.use((req, res, next) => {
  console.log(`Received ${req.method} request for ${req.url}`);
  next();
});

// Function to update the user's online status in the database
async function updateUserStatus(userId, onlineStatus) {
  try {
    await User.findByIdAndUpdate(userId, { isOnline: onlineStatus });
    console.log(`User ${userId} status updated to: ${onlineStatus}`);
  } catch (error) {
    console.error(`Error updating status for user ${userId}: `, error);
  }
}

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: frontendUrl,
    methods: ["GET", "POST"],
  },
});

const onlineUsers = {};

io.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("userOnline", async ({ userId }) => {
    onlineUsers[userId] = socket.id;
    console.log(`User ${userId} is online with socket ${socket.id}`);
    await updateUserStatus(userId, true);
    socket.broadcast.emit("userStatusChanged", { userId, isOnline: true });
  });

  socket.on("userOffline", async ({ userId }) => {
    console.log(`User ${userId} is going offline`);
    delete onlineUsers[userId];
    await updateUserStatus(userId, false);
    socket.broadcast.emit("userStatusChanged", { userId, isOnline: false });
  });

  socket.on("joinChatRooms", ({ userId }) => {
    console.log(`User ${userId} joined room ${userId}`);
    socket.join(userId.toString());
  });

  socket.on(
    "sendMessage",
    async ({ chatId, senderId, content, recipientId }) => {
      try {
        const newMessage = new Message({
          senderId,
          recipientId,
          chat: chatId,
          content,
          isRead: false,
        });

        const savedMessage = await newMessage.save();

        await Chat.findByIdAndUpdate(chatId, {
          latestMessage: savedMessage._id,
        });

        const populatedMessage = await Message.findById(savedMessage._id)
          .populate("senderId", "firstName lastName picturePath")
          .exec();

        console.log(`Sending message to user ${recipientId}`);
        io.to(recipientId).emit("receiveMessage", populatedMessage);
      } catch (error) {
        console.error("Failed to save message:", error);
        socket.emit("error", { message: "Failed to send message." });
      }
    }
  );

  socket.on("joinChat", ({ chatId }) => {
    console.log(`${socket.id} joined chat ${chatId}`);
    socket.join(chatId);
  });

  socket.on("leaveChat", ({ chatId }) => {
    console.log(`${socket.id} left chat ${chatId}`);
    socket.leave(chatId);
  });
  socket.on("markMessagesAsRead", async (data) => {
    try {
      // Mark messages as read in the database
      await Message.updateMany(
        { chat: data.chatId, recipientId: data.userId },
        { isRead: true }
      );
      socket.emit("messagesMarkedAsRead", {
        message: "Messages marked as read",
      });
    } catch (error) {
      console.error("Error marking messages as read:", error);
      socket.emit("error", { message: "Failed to mark messages as read" });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

/* FILE STORAGE */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    console.log("Saving file to destination");
    cb(null, "../client/public/assets");
  },
  filename: function (req, file, cb) {
    console.log("Saving file with filename:", file.originalname);
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

/* ROUTES WITH FILES */
app.post("/auth/register", upload.single("picture"), register);
app.post(
  "/posts",
  verifyToken,
  upload.single("picture"),
  (req, res, next) => {
    console.log("Route /posts called");
    console.log("Request body:", req.body);
    console.log("Request file:", req.file);
    next();
  },
  createPost
);

/* MONGOOSE SETUP */
const PORT = process.env.PORT || 6001;
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => {
    server.listen(PORT, () => console.log(`Server Port: ${PORT}`));
  })
  .catch((error) => console.log(`${error} did not connect`));
