const HEIGHT = 40;
const PALETTE = {
  dark: { color: "#0b0d0b", symbolColor: "#f4f5f1" },
  light: { color: "#edf3fa", symbolColor: "#24374c" },
};

export function desktopWindowChromeOptions(platform = process.platform) {
  // Keep the real Windows frame/caption buttons, including native snap support.
  return platform === "win32"
    ? { titleBarStyle: "hidden", titleBarOverlay: { ...PALETTE.dark, height: HEIGHT } }
    : {};
}

export function setWindowChromeTheme(window, theme, platform = process.platform) {
  if (theme !== "light" && theme !== "dark") throw new TypeError("Invalid workbench theme");
  if (platform !== "win32" || !window || window.isDestroyed()) return { supported: false };
  window.setTitleBarOverlay({ ...PALETTE[theme], height: HEIGHT });
  window.setBackgroundColor(PALETTE[theme].color);
  return { supported: true, theme };
}
