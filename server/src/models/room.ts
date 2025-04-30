import mongoose from "mongoose";

const fileSchema = new mongoose.Schema({
	name: String,
	content: String,
	type: { type: String, enum: ["file", "folder"], default: "file" },
	parentId: { type: mongoose.Schema.Types.ObjectId, ref: "File", default: null },
}, { timestamps: true });

const chatMessageSchema = new mongoose.Schema({
	username: String,
	message: String,
	timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

const roomSchema = new mongoose.Schema({
	roomId: { type: String, required: true, unique: true },
	files: [fileSchema],
	chatMessages: [chatMessageSchema],
	drawing: { type: mongoose.Schema.Types.Mixed }, // can be JSON
}, { timestamps: true });

export const RoomModel = mongoose.model("Room", roomSchema);
