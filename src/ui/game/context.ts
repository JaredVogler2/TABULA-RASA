"use client";

import { createContext, useContext } from "react";
import type { GameController } from "./controller";

export const ControllerContext = createContext<GameController | null>(null);

export function useController(): GameController {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error("GameController is not available outside <Game>");
  return controller;
}
