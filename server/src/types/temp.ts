import { RoomModel } from "../models/room";

// server start hone ke baad call karo
async function testRoomCreate() {
    try {
        const room = await RoomModel.create({ 
            roomId: "test-room-123", 
            files: [], 
            chatMessages: [], 
            drawing: {} 
        });
        console.log("Room created successfully:", room);
    } catch (err) {
        console.error("Failed to create room:", err);
    }
}

testRoomCreate();
