import { RoomModel } from "../models/room";
import { UserModel } from "../models/user";
import { ensureDbConnected } from "../config/db";

// Function to clean up stale data
async function cleanupStaleData() {
  try {
    await ensureDbConnected();
    
    // Delete inactive rooms older than 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const result = await RoomModel.deleteMany({
      updatedAt: { $lt: thirtyDaysAgo }
    });
    
    console.log(`Cleaned up ${result.deletedCount} stale rooms`);
    
    // Clean up disconnected users (offline for more than 24 hours)
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const userResult = await UserModel.deleteMany({
      status: "offline",
      updatedAt: { $lt: oneDayAgo }
    });
    
    console.log(`Cleaned up ${userResult.deletedCount} stale users`);
  } catch (error) {
    console.error("Error during scheduled cleanup:", error);
  }
}

// Function to verify database integrity
async function verifyDatabaseIntegrity() {
  try {
    await ensureDbConnected();
    
    // Check for rooms without roomId
    const invalidRooms = await RoomModel.find({ roomId: { $exists: false } });
    if (invalidRooms.length > 0) {
      console.warn(`Found ${invalidRooms.length} invalid rooms without roomId`);
      // Could add cleanup code here
    }
    
    // Count total rooms and files
    const totalRooms = await RoomModel.countDocuments();
    const totalFiles = await RoomModel.aggregate([
      { $project: { fileCount: { $size: "$files" } } },
      { $group: { _id: null, total: { $sum: "$fileCount" } } }
    ]);
    
    console.log(`Database status: ${totalRooms} rooms, ${totalFiles.length > 0 ? totalFiles[0].total : 0} files`);
  } catch (error) {
    console.error("Error during database integrity check:", error);
  }
}

// Start the scheduler
export function startDbScheduler() {
  console.log("Starting database scheduler...");
  
  // Run cleanup every day
  setInterval(cleanupStaleData, 24 * 60 * 60 * 1000);
  
  // Run integrity check every hour
  setInterval(verifyDatabaseIntegrity, 60 * 60 * 1000);
  
  // Run both immediately on startup
  cleanupStaleData();
  verifyDatabaseIntegrity();
  
  console.log("Database scheduler started");
}