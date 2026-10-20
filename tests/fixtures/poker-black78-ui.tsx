import React from "react";
import {createRoot} from "react-dom/client";
import {RoomView} from "../../app/room-client";
createRoot(document.getElementById("root")!).render(<RoomView tab="table"/>);
