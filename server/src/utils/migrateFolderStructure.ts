import { RoomModel } from "../models/room";
import mongoose from "mongoose";
import connectDB from "../config/db";

/**
 * Migration script to fix folder structure in existing rooms
 * - Updates files to store both originalId and MongoDB ObjectId
 * - Fixes parent-child relationships
 */
async function migrateFolderStructure() {
  try {
    console.log("Starting folder structure migration...");

    // Connect to database
    await connectDB();

    // Get all rooms
    const rooms = await RoomModel.find({});
    console.log(`Found ${rooms.length} rooms to migrate`);

    let migratedRooms = 0;

    for (const room of rooms) {
      console.log(`Migrating room: ${room.roomId}`);
      let needsUpdate = false;

      // First pass: ensure all files have originalId field
      for (const file of room.files) {
        if (!file.originalId) {
          file.originalId = file._id.toString();
          needsUpdate = true;
        }
      }

      // Second pass: fix parent-child relationships
      for (const file of room.files) {
        if (file.parentId) {
          // If parentId exists but isn't a valid ObjectId, we need to fix it
          if (!(file.parentId instanceof mongoose.Types.ObjectId)) {
            // Try to find the parent by its _id or originalId
            const parentFile = room.files.find((pf) => {
              const parentIdStr =
                file.parentId instanceof mongoose.Types.ObjectId
                  ? file.parentId.toString()
                  : String(file.parentId);

              return (
                pf._id.toString() === parentIdStr ||
                pf.originalId === parentIdStr
              );
            });

            if (parentFile) {
              file.parentId = parentFile._id;
              file.parentOriginalId =
                parentFile.originalId || parentFile._id.toString();
              needsUpdate = true;
            } else {
              // No parent found, set to null
              file.parentId = null;
              file.parentOriginalId = null;
              needsUpdate = true;
            }
          } else {
            // parentId is valid, ensure parentOriginalId is set
            if (!file.parentOriginalId) {
              file.parentOriginalId = file.parentId.toString();
              needsUpdate = true;
            }
          }
        }
      }

      // Save if changes were made
      if (needsUpdate) {
        await room.save();
        migratedRooms++;
        console.log(`Successfully migrated room: ${room.roomId}`);
      } else {
        console.log(`No changes needed for room: ${room.roomId}`);
      }
    }

    console.log(
      `Migration complete! Updated ${migratedRooms} out of ${rooms.length} rooms.`
    );
  } catch (error) {
    console.error("Error during folder structure migration:", error);
  } finally {
    // Optional: Close database connection if needed
    // await mongoose.connection.close();
  }
}

// Run the migration
migrateFolderStructure();

export default migrateFolderStructure;
