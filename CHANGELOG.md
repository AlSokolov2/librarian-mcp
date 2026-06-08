# Changelog

All notable changes to this project will be documented in this file.
## [5.1.0](https://github.com/AlSokolov2/librarian-mcp/compare/v5.0.0...v5.1.0) (2026-06-08)


### 🐛 Bug Fixes

* **git:** implement cold-start protocol for uninitialized repositories ([433d633](https://github.com/AlSokolov2/librarian-mcp/commit/433d633e090987eb231500bbc52b4155d22da105)), closes [#15](https://github.com/AlSokolov2/librarian-mcp/issues/15)
* **hub:** prevent EISDIR error by checking if path is a file during health check ([cfd298d](https://github.com/AlSokolov2/librarian-mcp/commit/cfd298d8fd1b085bb7d71df7c97cf405282e1f1e))
* **setup:** correct settings path to target local project's .gemini directory ([ef5f1c6](https://github.com/AlSokolov2/librarian-mcp/commit/ef5f1c6ce1380f608e858c256aedab6585ef684f))


### 🚀 Features

* **ci:** implement zero-tolerance quality gates ([2dcf72c](https://github.com/AlSokolov2/librarian-mcp/commit/2dcf72c2e1878a1171273dad4ab3b5e1a030cbf9))
* **core:** implement Hub Identity Protocol for context isolation ([670fd78](https://github.com/AlSokolov2/librarian-mcp/commit/670fd78c7778f2a87253af2627338e828a600f78)), closes [#11](https://github.com/AlSokolov2/librarian-mcp/issues/11) [#12](https://github.com/AlSokolov2/librarian-mcp/issues/12) [#13](https://github.com/AlSokolov2/librarian-mcp/issues/13)
* **protocol:** implement isolation protocol for persistent local contamination ([0480826](https://github.com/AlSokolov2/librarian-mcp/commit/0480826430c4f0c94bdb8e3fe10551753923da7a))
* **tests:** achieve 100% test coverage across monorepo ([4a5af7e](https://github.com/AlSokolov2/librarian-mcp/commit/4a5af7e6916093a627f8b189b9045bb83274c8d1))

## [5.0.0](https://github.com/AlSokolov2/librarian-mcp/compare/v4.0.0...v5.0.0) (2026-06-06)


### 🚀 Features

* **core:** implement v5 architecture and smart curation protocol ([9e32070](https://github.com/AlSokolov2/librarian-mcp/commit/9e32070c228ff0e128ca28d296014a3f0497707e))


### 🔨 Refactoring

* transition monorepo to modular Clean Architecture (v6) ([3cc16d4](https://github.com/AlSokolov2/librarian-mcp/commit/3cc16d4b1b50ab41311690d86e096cea1687e9e4))
