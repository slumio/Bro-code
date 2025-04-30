// models/User.ts
import mongoose, { Schema, Document } from "mongoose";
import { USER_CONNECTION_STATUS } from "../types/user"; // adjust path if needed

export interface UserDocument extends Document {
  username: string;
  roomId: string;
  status: string;
  cursorPosition: number;
  typing: boolean;
  currentFile: mongoose.Schema.Types.ObjectId | null; // Changed to ObjectId
  socketId: string;
}

const userSchema = new Schema<UserDocument>({
  username: { type: String, required: true },
  roomId: { type: String, required: true },
  status: {
    type: String,
    enum: Object.values(USER_CONNECTION_STATUS),
    default: USER_CONNECTION_STATUS.ONLINE,
  },
  cursorPosition: { type: Number, default: 0 },
  typing: { type: Boolean, default: false },
  currentFile: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "File", // Reference to File model
    default: null 
  },
  socketId: { type: String, required: true },
}, { timestamps: true });

export const UserModel = mongoose.model<UserDocument>("User", userSchema);
