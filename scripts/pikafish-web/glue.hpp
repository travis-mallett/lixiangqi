#pragma once

#include <condition_variable>
#include <cstdlib>
#include <emscripten.h>
#include <memory>
#include <mutex>
#include <queue>
#include <streambuf>
#include <string>

struct Command : public std::streambuf {
    enum Type { UCI, NNUE } type;
    std::string              uci;
    std::shared_ptr<void>    ptr = nullptr;

    explicit Command(const char* text) :
        type(UCI),
        uci(text) {
        std::free(const_cast<char*>(text));
    }

    Command(char* buffer, std::size_t size) :
        type(NNUE),
        ptr(buffer, std::free) {
        setg(buffer, buffer, buffer + size);
    }

    using std::streambuf::seekoff;
    using std::streambuf::seekpos;
};

struct CommandQueue {
    std::mutex              mutex;
    std::queue<Command>     commands;
    std::condition_variable available;

    void push(Command command) {
        std::unique_lock lock(mutex);
        // Match lila-stockfish-web's stream-buffer queue semantics so the NNUE
        // get area remains readable on the engine thread.
        commands.push(command);
        lock.unlock();
        available.notify_one();
    }

    Command pop() {
        std::unique_lock lock(mutex);
        available.wait(lock, [this] { return !commands.empty(); });
        Command command = std::move(commands.front());
        commands.pop();
        return command;
    }
};
