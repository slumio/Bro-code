import express, { Response, Request } from "express";
import dotenv from "dotenv";
import http from "http";
import cors from "cors";
import { SocketEvent, SocketId } from "./types/socket";
import { USER_CONNECTION_STATUS, User } from "./types/user";
import { Server } from "socket.io";
import path from "path";
import connectDB from "./config/db";
import mongoose from "mongoose";
import { UserModel } from "./models/user";
import { RoomModel } from "./models/room"; // Import RoomModel
import { registerSocketHandlers } from "./types/socketHandlers";
import { startDbScheduler } from "./utils/dbScheduler";

connectDB();
startDbScheduler();

dotenv.config();

const app = express();

app.use(express.json());

app.use(cors());

app.use(express.static(path.join(__dirname, "public"))); // Serve static files

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
  maxHttpBufferSize: 1e8,
  pingTimeout: 60000,
});

const safeObjectId = (
  id: string | null | undefined
): mongoose.Types.ObjectId | null => {
  if (!id) return null;
  try {
    return new mongoose.Types.ObjectId(id);
  } catch (error) {
    console.log(`Invalid ObjectId: ${id}, cannot convert to MongoDB ObjectId`);
    return null;
  }
};

// This function helps find a file/folder by either MongoDB ObjectID or UUID
const findFileById = (files: any[], fileId: string): any => {
  return files.find(
    (file) => file._id.toString() === fileId || file._id === fileId
  );
};

let userSocketMap: User[] = [];

app.get("/api/status", async (req: Request, res: Response) => {
  try {
    const dbStatus =
      mongoose.connection.readyState === 1 ? "connected" : "disconnected";
    const roomCount = await RoomModel.countDocuments();
    const userCount = await UserModel.countDocuments();

    res.json({
      status: "ok",
      database: dbStatus,
      stats: {
        rooms: roomCount,
        users: userCount,
        uptime: process.uptime(),
      },
    });
  } catch (err) {
    console.error("Error in status endpoint:", err);
    res
      .status(500)
      .json({ status: "error", message: "Failed to retrieve status" });
  }
});

interface UpdateFields {
  [key: string]: any;
}

const updateFields: UpdateFields = {};

// This function helps update a file when the ID is not a valid MongoDB ObjectId
const updateFileInRoom = async (
  roomId: string,
  fileId: string,
  updates: any
): Promise<boolean> => {
  try {
    // Try treating fileId as a MongoDB ObjectId
    let objId;
    try {
      objId = new mongoose.Types.ObjectId(fileId);
      const updateFields: Record<string, any> = {};
      Object.keys(updates).forEach((key) => {
        updateFields[`files.$[file].${key}`] = updates[key];
      });
      const result = await RoomModel.updateOne(
        { roomId },
        { $set: updateFields },
        { arrayFilters: [{ "file._id": objId }] }
      );
      return result.modifiedCount > 0;
    } catch (error) {
      // Fallback: update manually if ID is not valid ObjectId
      const room = await RoomModel.findOne({ roomId });
      if (!room) return false;
      const fileIndex = room.files.findIndex((file) => {
        const fileIdStr = fileId; // Already string
        const currentIdStr = file._id.toString();
        return currentIdStr === fileIdStr;
      });
      if (fileIndex === -1) return false;
      const file = room.files[fileIndex];
      Object.keys(updates).forEach((key) => {
        (file as any)[key] = updates[key];
      });
      await room.save();
      return true;
    }
  } catch (error) {
    console.error("Error in updateFileInRoom:", error);
    return false;
  }
};

// Function to get all users in a room
function getUsersInRoom(roomId: string): User[] {
  return userSocketMap.filter((user) => user.roomId == roomId);
}

// Function to get room id by socket id
function getRoomId(socketId: SocketId): string | null {
  const roomId = userSocketMap.find(
    (user) => user.socketId === socketId
  )?.roomId;

  if (!roomId) {
    console.error("Room ID is undefined for socket ID:", socketId);
    return null;
  }
  return roomId;
}

function getUserBySocketId(socketId: SocketId): User | null {
  const user = userSocketMap.find((user) => user.socketId === socketId);
  if (!user) {
    console.error("User not found for socket ID:", socketId);
    return null;
  }
  return user;
}

io.on("connection", (socket) => {
  // Handle user actions
  socket.on(SocketEvent.JOIN_REQUEST, async ({ roomId, username }) => {
    console.log(`${username} joined room ${roomId}`);

    // Check if room exists in MongoDB, if not create it
    let room = await RoomModel.findOne({ roomId });
    if (!room) {
      // Create new room if it doesn't exist
      room = new RoomModel({
        roomId,
        files: [],
        chatMessages: [],
        drawing: null,
      });
      await room.save();
      console.log(`Created new room ${roomId} in MongoDB`);
    }

    // Save user to MongoDB
    try {
      const newUser = new UserModel({
        username,
        roomId,
        status: USER_CONNECTION_STATUS.ONLINE,
        cursorPosition: 0,
        typing: false,
        currentFile: null,
        socketId: socket.id,
      });

      await newUser.save();
      console.log(`Saved user ${username} to MongoDB`);
    } catch (err) {
      console.error("Error saving user to DB:", err);
    }

    // Check is username exist in the room
    const isUsernameExist = getUsersInRoom(roomId).filter(
      (u) => u.username === username
    );
    if (isUsernameExist.length > 0) {
      io.to(socket.id).emit(SocketEvent.USERNAME_EXISTS);
      return;
    }

    const user = {
      username,
      roomId,
      status: USER_CONNECTION_STATUS.ONLINE,
      cursorPosition: 0,
      typing: false,
      socketId: socket.id,
      currentFile: null,
    };
    userSocketMap.push(user);
    socket.join(roomId);
    socket.broadcast.to(roomId).emit(SocketEvent.USER_JOINED, { user });
    const users = getUsersInRoom(roomId);
    io.to(socket.id).emit(SocketEvent.JOIN_ACCEPTED, { user, users });
  });

  socket.on("disconnecting", async () => {
    const user = getUserBySocketId(socket.id);
    if (!user) return;
    const roomId = user.roomId;
    socket.broadcast.to(roomId).emit(SocketEvent.USER_DISCONNECTED, { user });
    userSocketMap = userSocketMap.filter((u) => u.socketId !== socket.id);
    socket.leave(roomId);

    // Update user status in MongoDB
    try {
      await UserModel.findOneAndUpdate(
        { socketId: socket.id },
        { status: USER_CONNECTION_STATUS.OFFLINE }
      );
    } catch (err) {
      console.error("Error updating user status in DB:", err);
    }
  });

  // Handle file actions
  socket.on(
    SocketEvent.SYNC_FILE_STRUCTURE,
    ({ fileStructure, openFiles, activeFile, socketId }) => {
      io.to(socketId).emit(SocketEvent.SYNC_FILE_STRUCTURE, {
        fileStructure,
        openFiles,
        activeFile,
      });
    }
  );

  socket.on(
    SocketEvent.DIRECTORY_CREATED,
    async ({ parentDirId, newDirectory }) => {
      const roomId = getRoomId(socket.id);
      if (!roomId) return;

      // Update MongoDB with new directory
      try {
        const room = await RoomModel.findOne({ roomId });
        if (room) {
          const fileObj = {
            name: newDirectory.name,
            type: "folder",
            parentId:
              parentDirId && mongoose.Types.ObjectId.isValid(parentDirId)
                ? new mongoose.Types.ObjectId(parentDirId)
                : null,
          };
          room.files.push(fileObj);
          await room.save();
          console.log(
            `Directory ${newDirectory.name} created in room ${roomId}`
          );
        }
      } catch (err) {
        console.error("Error creating directory in DB:", err);
      }

      socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_CREATED, {
        parentDirId,
        newDirectory,
      });
    }
  );

  socket.on(SocketEvent.DIRECTORY_UPDATED, async ({ dirId, children }) => {
    const roomId = getRoomId(socket.id);
    if (!roomId) return;

    // You might need to implement logic to update children in MongoDB
    // This depends on your exact data model and requirements

    socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_UPDATED, {
      dirId,
      children,
    });
  });

  socket.on(SocketEvent.DIRECTORY_RENAMED, async ({ dirId, newName }) => {
    const roomId = getRoomId(socket.id);
    if (!roomId) return;

    // Update directory name in MongoDB
    try {
      await RoomModel.updateOne(
        { roomId, "files._id": dirId },
        { $set: { "files.$.name": newName } }
      );
      console.log(`Directory ${dirId} renamed to ${newName} in room ${roomId}`);
    } catch (err) {
      console.error("Error renaming directory in DB:", err);
    }

    socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_RENAMED, {
      dirId,
      newName,
    });
  });

  socket.on(SocketEvent.DIRECTORY_DELETED, async ({ dirId }) => {
    const roomId = getRoomId(socket.id);
    if (!roomId) return;

    // Delete directory from MongoDB
    try {
      await RoomModel.updateOne(
        { roomId },
        { $pull: { files: { _id: dirId } } }
      );
      console.log(`Directory ${dirId} deleted from room ${roomId}`);
    } catch (err) {
      console.error("Error deleting directory from DB:", err);
    }

    socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_DELETED, { dirId });
  });

  socket.on(SocketEvent.FILE_CREATED, async ({ parentDirId, newFile }) => {
    const roomId = getRoomId(socket.id);
    if (!roomId) {
      console.error("No roomId found for socket", socket.id);
      return;
    }

    console.log(
      `Attempting to create file ${newFile.name} in room ${roomId}, parent: ${
        parentDirId || "root"
      }`
    );

    // Create file in MongoDB
    try {
      const room = await RoomModel.findOne({ roomId });
      if (!room) {
        console.error(`Room ${roomId} not found in database`);
        return;
      }

      // Store both the original ID and convert to MongoDB ObjectId if possible
      let parentObjectId = null;

      if (parentDirId) {
        // First try to find the parent by its _id in the database
        const parentFolder = room.files.find(
          (file) =>
            file._id.toString() === parentDirId ||
            file.originalId === parentDirId
        );

        if (parentFolder) {
          // Use the MongoDB ObjectId from the found parent
          parentObjectId = parentFolder._id;
          console.log(
            `Found parent folder with matching ID: ${parentObjectId}`
          );
        } else {
          // Try direct conversion as fallback
          try {
            parentObjectId = new mongoose.Types.ObjectId(parentDirId);
            console.log(`Converted parentDirId ${parentDirId} to ObjectId`);
          } catch (error) {
            console.warn(
              `Cannot convert parentDirId ${parentDirId} to ObjectId, will use null`
            );
          }
        }
      }

      // Create the file object, storing both original frontend ID and MongoDB ID references
      const fileObj = {
        name: newFile.name,
        content: newFile.content || "",
        type: "file",
        originalId: newFile.id || null, // Store the original UUID from frontend
        parentId: parentObjectId, // Store as MongoDB ObjectId
        parentOriginalId: parentDirId, // Also store the original parent ID string
      };

      console.log("Creating file object:", {
        name: fileObj.name,
        type: fileObj.type,
        parentId: fileObj.parentId ? fileObj.parentId.toString() : null,
        parentOriginalId: fileObj.parentOriginalId,
      });

      room.files.push(fileObj);

      const savedRoom = await room.save();

      // Get the saved file with its new MongoDB _id
      const savedFile = savedRoom.files[savedRoom.files.length - 1];
      console.log(`File saved with _id: ${savedFile._id}`);

      // Provide both IDs when broadcasting to clients
      const fileInfo = {
        ...newFile,
        _id: savedFile._id,
        mongoId: savedFile._id.toString(),
      };

      socket.broadcast
        .to(roomId)
        .emit(SocketEvent.FILE_CREATED, { parentDirId, newFile: fileInfo });
    } catch (err) {
      console.error("Error creating file in DB:", err);
    }
  });

  socket.on(SocketEvent.FILE_UPDATED, async ({ fileId, newContent }) => {
    const roomId = getRoomId(socket.id);
    if (!roomId) return;

    console.log(`📝 Attempting to update file ${fileId} in room ${roomId}`);

    try {
      let updateResult: any;

      // Try using MongoDB ObjectId
      if (mongoose.isValidObjectId(fileId)) {
        const objId = new mongoose.Types.ObjectId(fileId);
        updateResult = await RoomModel.updateOne(
          { roomId, "files._id": objId },
          { $set: { "files.$.content": newContent } }
        );

        if (updateResult.modifiedCount > 0) {
          console.log(`✅ Updated file ${fileId} using _id`);
        }
      }

      // If updateResult is null or didn't modify anything, try by originalId
      if (!updateResult || updateResult.modifiedCount === 0) {
        updateResult = await RoomModel.updateOne(
          { roomId, "files.originalId": fileId },
          { $set: { "files.$.content": newContent } }
        );

        if (updateResult.modifiedCount > 0) {
          console.log(`✅ Updated file ${fileId} using originalId`);
        }
      }

      // Final fallback — manual update
      if (!updateResult || updateResult.modifiedCount === 0) {
        const room = await RoomModel.findOne({ roomId });
        if (!room) {
          console.warn(`❌ Room ${roomId} not found`);
          return;
        }

        const fileIndex = room.files.findIndex(
          (file) => file._id.toString() === fileId || file.originalId === fileId
        );

        if (fileIndex === -1) {
          console.warn(`❌ File ${fileId} not found in room ${roomId}`);
          return;
        }

        room.files[fileIndex].content = newContent;
        await room.save();
        console.log(`✅ Updated file manually in MongoDB for room ${roomId}`);
      }

      // 🔄 Emit updated structure or file to all other clients in the room
      const updatedRoom = await RoomModel.findOne({ roomId });
      if (updatedRoom) {
        io.to(roomId).emit(SocketEvent.FILE_STRUCTURE_UPDATED, {
          files: updatedRoom.files,
        });
      }
    } catch (err) {
      console.error("❌ Error updating file in DB:", err);
    }
  });

  socket.on(SocketEvent.FILE_RENAMED, async ({ fileId, newName }) => {
    const roomId = getRoomId(socket.id);
    if (!roomId) return;

    // Rename file in MongoDB
    try {
      await RoomModel.updateOne(
        { roomId, "files._id": fileId },
        { $set: { "files.$.name": newName } }
      );
      console.log(`File ${fileId} renamed to ${newName} in room ${roomId}`);
    } catch (err) {
      console.error("Error renaming file in DB:", err);
    }

    socket.broadcast.to(roomId).emit(SocketEvent.FILE_RENAMED, {
      fileId,
      newName,
    });
  });

  socket.on(SocketEvent.FILE_DELETED, async ({ fileId }) => {
    const roomId = getRoomId(socket.id);
    if (!roomId) return;

    // Delete file from MongoDB
    try {
      await RoomModel.updateOne(
        { roomId },
        { $pull: { files: { _id: fileId } } }
      );
      console.log(`File ${fileId} deleted from room ${roomId}`);
    } catch (err) {
      console.error("Error deleting file from DB:", err);
    }

    socket.broadcast.to(roomId).emit(SocketEvent.FILE_DELETED, { fileId });
  });

  // Handle user status
  socket.on(SocketEvent.USER_OFFLINE, async ({ socketId }) => {
    userSocketMap = userSocketMap.map((user) => {
      if (user.socketId === socketId) {
        return { ...user, status: USER_CONNECTION_STATUS.OFFLINE };
      }
      return user;
    });
    const roomId = getRoomId(socketId);
    if (!roomId) return;

    // Update user status in MongoDB
    try {
      await UserModel.findOneAndUpdate(
        { socketId },
        { status: USER_CONNECTION_STATUS.OFFLINE }
      );
    } catch (err) {
      console.error("Error updating user status in DB:", err);
    }

    socket.broadcast.to(roomId).emit(SocketEvent.USER_OFFLINE, { socketId });
  });

  socket.on(SocketEvent.USER_ONLINE, async ({ socketId }) => {
    userSocketMap = userSocketMap.map((user) => {
      if (user.socketId === socketId) {
        return { ...user, status: USER_CONNECTION_STATUS.ONLINE };
      }
      return user;
    });
    const roomId = getRoomId(socketId);
    if (!roomId) return;

    // Update user status in MongoDB
    try {
      await UserModel.findOneAndUpdate(
        { socketId },
        { status: USER_CONNECTION_STATUS.ONLINE }
      );
    } catch (err) {
      console.error("Error updating user status in DB:", err);
    }

    socket.broadcast.to(roomId).emit(SocketEvent.USER_ONLINE, { socketId });
  });

  // Handle chat actions
  socket.on(SocketEvent.SEND_MESSAGE, async ({ message }) => {
    const roomId = getRoomId(socket.id);
    if (!roomId) return;

    // Save chat message to MongoDB
    try {
      await RoomModel.findOneAndUpdate(
        { roomId },
        {
          $push: {
            chatMessages: {
              username: message.username,
              message: message.message,
              timestamp: new Date(),
            },
          },
        },
        { new: true }
      );
      console.log(`Message from ${message.username} saved to room ${roomId}`);
    } catch (err) {
      console.error("Error saving chat message to DB:", err);
    }

    socket.broadcast.to(roomId).emit(SocketEvent.RECEIVE_MESSAGE, { message });
  });

  // Handle cursor position
  socket.on(SocketEvent.TYPING_START, async ({ cursorPosition }) => {
    userSocketMap = userSocketMap.map((user) => {
      if (user.socketId === socket.id) {
        return { ...user, typing: true, cursorPosition };
      }
      return user;
    });
    const user = getUserBySocketId(socket.id);
    if (!user) return;
    const roomId = user.roomId;

    // Update user typing status in MongoDB
    try {
      await UserModel.findOneAndUpdate(
        { socketId: socket.id },
        { typing: true, cursorPosition }
      );
    } catch (err) {
      console.error("Error updating user typing status in DB:", err);
    }

    socket.broadcast.to(roomId).emit(SocketEvent.TYPING_START, { user });
  });

  socket.on(SocketEvent.TYPING_PAUSE, async () => {
    userSocketMap = userSocketMap.map((user) => {
      if (user.socketId === socket.id) {
        return { ...user, typing: false };
      }
      return user;
    });
    const user = getUserBySocketId(socket.id);
    if (!user) return;
    const roomId = user.roomId;

    // Update user typing status in MongoDB
    try {
      await UserModel.findOneAndUpdate(
        { socketId: socket.id },
        { typing: false }
      );
    } catch (err) {
      console.error("Error updating user typing status in DB:", err);
    }

    socket.broadcast.to(roomId).emit(SocketEvent.TYPING_PAUSE, { user });
  });

  socket.on(SocketEvent.REQUEST_DRAWING, () => {
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast
      .to(roomId)
      .emit(SocketEvent.REQUEST_DRAWING, { socketId: socket.id });
  });

  socket.on(SocketEvent.SYNC_DRAWING, ({ drawingData, socketId }) => {
    socket.broadcast
      .to(socketId)
      .emit(SocketEvent.SYNC_DRAWING, { drawingData });
  });

  socket.on(SocketEvent.DRAWING_UPDATE, async ({ snapshot }) => {
    const roomId = getRoomId(socket.id);
    if (!roomId) return;

    // Save drawing to MongoDB
    try {
      await RoomModel.findOneAndUpdate({ roomId }, { drawing: snapshot });
      console.log(`Drawing updated in room ${roomId}`);
    } catch (err) {
      console.error("Error saving drawing to DB:", err);
    }

    socket.broadcast.to(roomId).emit(SocketEvent.DRAWING_UPDATE, {
      snapshot,
    });
  });
});

const PORT = process.env.PORT || 3000;

app.get("/", (req: Request, res: Response) => {
  // Send the index.html file
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// Add a route to get all rooms (for debugging)
app.get("/api/rooms", async (req: Request, res: Response) => {
  try {
    const rooms = await RoomModel.find({});
    res.json(rooms);
  } catch (err) {
    console.error("Error fetching rooms:", err);
    res.status(500).json({ error: "Failed to fetch rooms" });
  }
});

// Add a route to get a specific room's data
app.get("/api/rooms/:roomId", async (req: Request, res: Response) => {
  try {
    const room = await RoomModel.findOne({ roomId: req.params.roomId });
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }
    res.json(room);
  } catch (err) {
    console.error("Error fetching room:", err);
    res.status(500).json({ error: "Failed to fetch room" });
  }
});

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
