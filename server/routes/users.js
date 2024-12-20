import express from "express";
import {
  getAllUsers,
  getUser,
  getUserFriends,
  addRemoveFriend,
  addSocialMedia,
} from "../controllers/users.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

/* READ */
router.get("/", verifyToken, getAllUsers);
router.get("/:id", verifyToken, getUser);
router.get("/:id/friends", verifyToken, getUserFriends);

/* UPDATE */
router.patch("/:id/:friendId", verifyToken, addRemoveFriend);
router.patch("/:userId", verifyToken, addSocialMedia); //--------------

export default router;
