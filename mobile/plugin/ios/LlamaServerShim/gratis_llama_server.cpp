// Upstream exports these with C++ linkage (tools/server/server.cpp)
#include "gratis_llama_server.h"

int llama_server( int argc, char ** argv );
void llama_server_terminate();

extern "C" int gratis_llama_server_run( int argc, char ** argv ) {
    try {
        return llama_server( argc, argv );
    } catch( ... ) {
        // An escaping exception would take the whole app down with it
        return 1;
    }
}

extern "C" void gratis_llama_server_stop( void ) {
    llama_server_terminate();
}
