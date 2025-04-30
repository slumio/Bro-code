import { Server, Socket } from "socket.io";
import { SocketEvent } from "../types/socket"; // adjust path if needed
import { RoomModel } from "../models/room"; // new room model (I will explain below)
import mongoose from "mongoose";

export const registerSocketHandlers = (io: Server, socket: Socket) => {
	const { id: socketId } = socket;

	console.log(`Socket connected: ${socketId}`);

	// When a file or folder is created/updated/deleted
	socket.on(SocketEvent.FILE_CREATED, async ({ roomId, file }) => {
		const room = await RoomModel.findOne({ roomId });
        if (!room) {
            await RoomModel.create({ roomId, files: [file] });
        } else {
            await RoomModel.updateOne(
                { roomId },
                { $push: { files: file } }
            );
        }
		io.to(roomId).emit(SocketEvent.FILE_CREATED, { file });
	});

	socket.on(SocketEvent.FILE_UPDATED, async ({ roomId, fileId, newContent }) => {
        await RoomModel.updateOne(
			{ roomId },
			{ $set: { "files.$[file].content": newContent } },
			{
			  arrayFilters: [{ "file._id": new mongoose.Types.ObjectId(fileId) }],
			}
		  );		  
        io.to(roomId).emit(SocketEvent.FILE_UPDATED, { fileId, newContent });
    });

	socket.on(SocketEvent.FILE_DELETED, async ({ roomId, fileId }) => {
        await RoomModel.updateOne(
            { roomId },
            { $pull: { files: { _id: new mongoose.Types.ObjectId(fileId) } } }
        );
        io.to(roomId).emit(SocketEvent.FILE_DELETED, { fileId });
    });
    

	// When a new chat message is sent
	socket.on(SocketEvent.SEND_MESSAGE, async ({ roomId, message }) => {
        const room = await RoomModel.findOne({ roomId });
        if (!room) {
            await RoomModel.create({ roomId, chatMessages: [message] });
        } else {
            await RoomModel.updateOne(
                { roomId },
                { $push: { chatMessages: message } }
            );
        }
        io.to(roomId).emit(SocketEvent.RECEIVE_MESSAGE, { message });
    });
    

	// When a drawing is updated
	socket.on(SocketEvent.DRAWING_UPDATE, async ({ roomId, drawingData }) => {
		await RoomModel.updateOne(
			{ roomId },
			{ $set: { drawing: drawingData } },
			{ upsert: true }
		);
		socket.broadcast.to(roomId).emit(SocketEvent.DRAWING_UPDATE, { drawingData });
	});

	// Load full saved room data (optional)
	socket.on(SocketEvent.LOAD_ROOM_DATA, async ({ roomId }) => {
		const room = await RoomModel.findOne({ roomId });
		if (room) {
			socket.emit(SocketEvent.ROOM_DATA, {
				files: room.files,
				chatMessages: room.chatMessages,
				drawing: room.drawing,
			});
		}
	});

	socket.on("disconnect", () => {
		console.log(`Socket disconnected: ${socketId}`);
	});
};
