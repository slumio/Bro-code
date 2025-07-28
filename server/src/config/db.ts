import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// Global options for all connections
mongoose.set('strictQuery', false);
mongoose.set('debug', process.env.NODE_ENV !== 'production'); // Log queries in dev mode

const connectDB = async (): Promise<mongoose.Connection> => {
  try {
    if (mongoose.connection.readyState === 1) {
      console.log("✅ MongoDB already connected!");
      return mongoose.connection;
    }
    
    await mongoose.connect(process.env.MONGO_URI as string, {
      // Optional connection settings that improve reliability:
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
    });
    
    const db = mongoose.connection;
    
    // Set up connection error handlers
    db.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });
    
    db.on('disconnected', () => {
      console.log('MongoDB disconnected, attempting to reconnect...');
    });
    
    db.on('reconnected', () => {
      console.log('✅ MongoDB reconnected!');
    });
    
    console.log("✅ MongoDB connected successfully!");
    return db;
  } catch (error) {
    console.error("❌ Error connecting to MongoDB:", error);
    process.exit(1);
  }
};

// Add a helper function to ensure database connection is active
export const ensureDbConnected = async (): Promise<boolean> => {
  if (mongoose.connection.readyState === 1) {
    return true;
  }
  
  try {
    await connectDB();
    return true;
  } catch (error) {
    console.error("Failed to ensure database connection:", error);
    return false;
  }
};

export default connectDB;