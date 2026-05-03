import mongoose, { Schema, Document, models, model } from "mongoose";

// ✅ Define TypeScript interface
export interface IUser extends Document {
  name: string;
  email: string;
  password?: string;
  image?: string;
  hasOnboarded: boolean;
  providers: string[];
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
}

// ✅ Create schema with type
const UserSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      default: "",
    },
    email: {
      type: String,
      unique: true,
      required: true,
    },
    password: {
      type: String,
      default: "", // 🔥 needed for credentials login
    },
    image: {
      type: String,
      default: "",
    },
    hasOnboarded: {
      type: Boolean,
      default: false,
    },
    providers: {
      type: [String],
      default: [],
    },
    resetPasswordToken: {
      type: String,
      default: undefined,
    },
    resetPasswordExpires: {
      type: Date,
      default: undefined,
    },
  },
  {
    timestamps: true,
  }
);

// ✅ Properly typed model
const User = (models.User as mongoose.Model<IUser>) || model<IUser>("User", UserSchema);

export default User;