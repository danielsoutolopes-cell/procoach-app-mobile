// Patch fs.watch BEFORE metro loads to silently handle ENOENT errors from
// pnpm postinstall temporary directories (e.g. expo-notifications_tmp_XXXX,
// twilio_tmp_XXXX). These dirs are created during `pnpm add` and removed
// immediately after, but Metro's FallbackWatcher still tries to watch their
// subdirectories and crashes with ENOENT.
const fs = require("fs");
const EventEmitter = require("events");
const _origWatch = fs.watch;
fs.watch = function patchedWatch(p, options, listener) {
  try {
    return _origWatch.call(fs, p, options, listener);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      // Return a no-op watcher so Metro can continue without crashing
      const noop = new EventEmitter();
      noop.close = () => {};
      return noop;
    }
    throw err;
  }
};

const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

module.exports = config;
