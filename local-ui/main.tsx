import React from "react";
import { createRoot } from "react-dom/client";
import Dashboard from "../app/ui/dashboard";
import Menu from "../app/ui/menu";
import CreatorDashboard from "../app/ui/creator-dashboard";
import OwnerLauncher from "../app/ui/owner-launcher";
import "../app/globals.css";
import "../app/product.css";
import "../app/creator.css";
const path = location.pathname;
const restaurant = path.match(/^\/r\/[a-f0-9-]{36}(\/.*)?$/);
const sub = restaurant?.[1] || "/";
createRoot(document.getElementById("root")!).render(
  path === "/creator" ? (
    <CreatorDashboard />
  ) : path === "/owner" ? (
    <OwnerLauncher />
  ) : sub === "/menu" || sub === "/portal" ? (
    <Menu />
  ) : path === "/demo" ? (
    <Menu demo />
  ) : sub === "/preview" ? (
    <Menu preview />
  ) : (
    <Dashboard />
  ),
);
