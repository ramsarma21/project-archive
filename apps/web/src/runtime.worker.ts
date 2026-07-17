// Thin worker entry. It only pulls in the headless runtime worker logic, which
// sets self.onmessage. This file (and the whole app) is the disposable
// presentation layer; the runtime imported here has no React/DOM dependency.
import "@pa/runtime/worker";
