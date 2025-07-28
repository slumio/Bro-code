import mongoose from "mongoose";

// Updated fileSchema with better ID handling
const fileSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  content: { type: String, default: "" },
  type: { type: String, enum: ["file", "folder"], default: "file" },
  // Store both the original ID from frontend and MongoDB ObjectId
  originalId: { type: String, default: null }, // Store UUID or other ID format from frontend
  parentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "File", 
    default: null,
    required: false 
  },
  // Add a string version of parentId for easier lookups when using UUIDs
  parentOriginalId: { type: String, default: null, required: false }
}, { 
  timestamps: true,
  _id: true
});

// Add a hook to convert UUID to ObjectId when setting parentId
fileSchema.pre('save', function(next) {
  // If parentOriginalId exists but parentId doesn't, try to convert
  if (this.parentOriginalId && !this.parentId) {
    try {
      this.parentId = new mongoose.Types.ObjectId(this.parentOriginalId);
    } catch (err) {
      // Keep parentId as null if conversion fails
      console.log(`Could not convert parentOriginalId ${this.parentOriginalId} to ObjectId`);
    }
  }
  next();
});

const chatMessageSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now, index: true },
}, { 
  timestamps: true 
});

const roomSchema = new mongoose.Schema({
  roomId: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true,
    index: true
  },
  files: [fileSchema],
  chatMessages: [chatMessageSchema],
  drawing: { type: mongoose.Schema.Types.Mixed },
  lastActivity: { type: Date, default: Date.now }
}, { 
  timestamps: true 
});

// Add middleware to update lastActivity timestamp
roomSchema.pre('findOneAndUpdate', function(next) {
  (this as any).set('lastActivity', new Date());
  next();
});

roomSchema.methods.getRecentMessages = function(limit = 50) {
  return this.chatMessages
    .sort((a: any, b: any) => b.timestamp - a.timestamp)
    .slice(0, limit);
};

roomSchema.index({ roomId: 1, "files.parentId": 1 });
roomSchema.index({ "files.originalId": 1 }); // Add index for originalId lookups

export const RoomModel = mongoose.model("Room", roomSchema);