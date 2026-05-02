import cookieParser from "cookie-parser";
import express from "express";

import "./config/env.js";
import { authRouter } from "./routes/auth.js";
import { executeRouter } from "./routes/execute.js";
import { type AuthenticatedRequest, validateToken } from "./middleware/validateToken.js";
import { roomsRouter } from "./routes/rooms.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/execute", executeRouter);
app.use("/rooms", roomsRouter);

app.get("/protected", validateToken, (req: AuthenticatedRequest, res) => {
  res.status(200).json({ user: req.user });
});

app.listen(port, () => {
  console.log(`API server running on port ${port}`);
});
