import cookieParser from "cookie-parser";
import express from "express";

import { authRouter } from "./routes/auth.js";
import { type AuthenticatedRequest, validateToken } from "./middleware/validateToken.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/auth", authRouter);

app.get("/protected", validateToken, (req: AuthenticatedRequest, res) => {
  res.status(200).json({ user: req.user });
});

app.listen(port, () => {
  console.log(`API server running on port ${port}`);
});
