import express from "express";
import userRoutes from "./userRoutes";
import "./mailWorker";

const app = express();
app.use(express.json());
app.use(userRoutes);

app.listen(3000, () => console.log("Server started on port 3000"));