// C entry points into upstream llama.cpp `llama-server` (tools/server), for Swift
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// Run the server with command-line style arguments; blocks until it stops
int gratis_llama_server_run( int argc, char ** argv );

// Ask a running server to shut down (returns at once; run() then returns)
void gratis_llama_server_stop( void );

#ifdef __cplusplus
}
#endif
