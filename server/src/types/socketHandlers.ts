import { Server, Socket } from "socket.io";
import { SocketEvent } from "../types/socket";
import { RoomModel } from "../models/room";
import mongoose from "mongoose";
import { ensureDbConnected } from "../config/db";

// Helper function to safely convert IDs to ObjectId or return null
const safeObjectId = (id: string | null | undefined): mongoose.Types.ObjectId | null => {
  if (!id) return null;
  try {
    return new mongoose.Types.ObjectId(id);
  } catch (error) {
    console.log(`Invalid ObjectId: ${id}`);
    return null;
  }
};

export const registerSocketHandlers = (io: Server, socket: Socket) => {
  const { id: socketId } = socket;

  console.log(`Socket connected: ${socketId}`);

  // When a file or folder is created/updated/deleted
  socket.on(SocketEvent.FILE_CREATED, async ({ roomId, file }) => {
    try {
      await ensureDbConnected();
      
      const room = await RoomModel.findOne({ roomId });
      if (!room) {
        const newRoom = await RoomModel.create({ roomId, files: [file] });
        console.log(`Created new room with file: ${newRoom._id}`);
      } else {
        const result = await RoomModel.updateOne(
          { roomId },
          { $push: { files: file } }
        );
        
        if (result.modifiedCount === 0) {
          console.warn(`Failed to add file to room ${roomId} - no documents modified`);
        } else {
          console.log(`Added file to room ${roomId}`);
        }
      }
      
      io.to(roomId).emit(SocketEvent.FILE_CREATED, { file });
    } catch (error) {
      console.error(`Error in FILE_CREATED handler:`, error);
      socket.emit('error', { message: 'Failed to create file' });
    }
  });

  socket.on(SocketEvent.FILE_UPDATED, async ({ roomId, fileId, newContent }) => {
    try {
      await ensureDbConnected();
      
      // First try direct MongoDB ObjectId conversion
      let objId;
      try {
        objId = new mongoose.Types.ObjectId(fileId);
      } catch (error) {
        // If conversion fails, try to find the file by using $elemMatch on name or other properties
        // This is a fallback if you're using UUID or other ID formats in your frontend
        const room = await RoomModel.findOne({ roomId });
        if (!room) {
          console.warn(`Room ${roomId} not found`);
          return;
        }
        
        // Find the file in the files array and update it directly
        const fileIndex = room.files.findIndex(file => file._id.toString() === fileId || file._id === fileId);
        if (fileIndex === -1) {
          console.warn(`File ${fileId} not found in room ${roomId}`);
          return;
        }
        
        room.files[fileIndex].content = newContent;
        await room.save();
        console.log(`Updated file using fallback method in room ${roomId}`);
        io.to(roomId).emit(SocketEvent.FILE_UPDATED, { fileId, newContent });
        return;
      }
      
      // If ObjectId conversion succeeded, use the more efficient update method
      const result = await RoomModel.updateOne(
        { roomId },
        { $set: { "files.$[file].content": newContent } },
        {
          arrayFilters: [{ "file._id": objId }],
        }
      );
      
      if (result.modifiedCount === 0) {
        console.warn(`Failed to update file ${fileId} in room ${roomId} - no documents modified`);
      } else {
        console.log(`Updated file ${fileId} in room ${roomId}`);
      }
      
      io.to(roomId).emit(SocketEvent.FILE_UPDATED, { fileId, newContent });
    } catch (error) {
      console.error(`Error in FILE_UPDATED handler:`, error);
      socket.emit('error', { message: 'Failed to update file' });
    }
  });

  socket.on(SocketEvent.FILE_DELETED, async ({ roomId, fileId }) => {
    try {
      await ensureDbConnected();
      
      // Try to convert to ObjectId, but handle gracefully if it fails
      let objId;
      try {
        objId = new mongoose.Types.ObjectId(fileId);
      } catch (error) {
        // Fallback: find by the string ID or other properties
        const room = await RoomModel.findOne({ roomId });
        if (!room) {
          console.warn(`Room ${roomId} not found`);
          return;
        }
        
        // Find the file index to remove
        const fileIndex = room.files.findIndex(file => 
          file._id.toString() === fileId || file._id === fileId);
        
        if (fileIndex === -1) {
          console.warn(`File ${fileId} not found in room ${roomId}`);
          return;
        }
        
        // Remove file from array
        room.files.splice(fileIndex, 1);
        await room.save();
        
        console.log(`Deleted file using fallback method in room ${roomId}`);
        io.to(roomId).emit(SocketEvent.FILE_DELETED, { fileId });
        return;
      }
      
      // If ObjectId conversion succeeded, use the more efficient update method
      const result = await RoomModel.updateOne(
        { roomId },
        { $pull: { files: { _id: objId } } }
      );
      
      if (result.modifiedCount === 0) {
        console.warn(`Failed to delete file ${fileId} from room ${roomId} - no documents modified`);
      } else {
        console.log(`Deleted file ${fileId} from room ${roomId}`);
      }
      
      io.to(roomId).emit(SocketEvent.FILE_DELETED, { fileId });
    } catch (error) {
      console.error(`Error in FILE_DELETED handler:`, error);
      socket.emit('error', { message: 'Failed to delete file' });
    }
  });

  // When a new chat message is sent - optimized implementation
  socket.on(SocketEvent.SEND_MESSAGE, async ({ roomId, message }) => {
    try {
      await ensureDbConnected();
      
      const result = await RoomModel.findOneAndUpdate(
        { roomId },
        { $push: { chatMessages: message } },
        { upsert: true, new: true, runValidators: true }
      );
      
      console.log(`Added message to room ${roomId}, new message count: ${result.chatMessages.length}`);
      
      io.to(roomId).emit(SocketEvent.RECEIVE_MESSAGE, { message });
    } catch (error) {
      console.error(`Error in SEND_MESSAGE handler:`, error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // When a drawing is updated
  socket.on(SocketEvent.DRAWING_UPDATE, async ({ roomId, drawingData }) => {
    try {
      await ensureDbConnected();
      
      const result = await RoomModel.updateOne(
        { roomId },
        { $set: { drawing: drawingData } },
        { upsert: true }
      );
      
      if (result.upsertedCount > 0) {
        console.log(`Created new room ${roomId} with drawing data`);
      } else if (result.modifiedCount > 0) {
        console.log(`Updated drawing in room ${roomId}`);
      } else {
        console.warn(`No changes to drawing in room ${roomId}`);
      }
      
      socket.broadcast.to(roomId).emit(SocketEvent.DRAWING_UPDATE, { drawingData });
    } catch (error) {
      console.error(`Error in DRAWING_UPDATE handler:`, error);
      socket.emit('error', { message: 'Failed to update drawing' });
    }
  });

  // Load full saved room data (optional) - improved with error handling
  socket.on(SocketEvent.LOAD_ROOM_DATA, async ({ roomId }) => {
    try {
      await ensureDbConnected();
      
      const room = await RoomModel.findOne({ roomId });
      
      if (room) {
        console.log(`Sending room data for ${roomId}: ${room.files.length} files, ${room.chatMessages.length} messages`);
        
        socket.emit(SocketEvent.ROOM_DATA, {
          files: room.files,
          chatMessages: room.chatMessages,
          drawing: room.drawing,
        });
      } else {
        console.log(`Room ${roomId} not found, sending empty data`);
        socket.emit(SocketEvent.ROOM_DATA, {
          files: [],
          chatMessages: [],
          drawing: null,
        });
      }
    } catch (error) {
      console.error(`Error in LOAD_ROOM_DATA handler:`, error);
      socket.emit('error', { message: 'Failed to load room data' });
    }
  });

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socketId}`);
  });
};