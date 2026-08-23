import { useState, useEffect, useCallback } from 'react'
import { log } from 'mentie'
import { v4 as uuid } from 'uuid'
import { get_db } from '../stores/db'
import { storage_key } from '../utils/branding'

const active_model_key = storage_key( `active_model_id` )

/**
 * Hook for managing chat history in IndexedDB
 * Provides CRUD operations for conversations and messages
 * @returns {Object} Chat history operations
 */
export default function use_chat_history() {

    const [ conversations, set_conversations ] = useState( [] )
    const [ is_loading, set_is_loading ] = useState( true )

    /**
     * Load all conversations sorted by updated_at (most recent first)
     */
    const load_conversations = useCallback( async () => {

        try {

            const db = await get_db()
            const all = await db.getAllFromIndex( `conversations`, `updated_at` )
            // Reverse so most recent is first
            set_conversations( all.reverse() )
            log.debug( `[chat_history] Loaded ${ all.length } conversations` )

        } catch ( err ) {
            log.error( `Failed to load conversations:`, err )
        } finally {
            set_is_loading( false )
        }

    }, [] )

    // Load conversations on mount
    useEffect( () => {
        load_conversations()
    }, [ load_conversations ] )

    /**
     * Create a new conversation
     * @param {string} title - Conversation title (first user message, truncated)
     * @param {string} [model_id] - Model used for this conversation
     * @param {string} [id_override] - Existing conversation ID to persist
     * @returns {Promise<string>} New conversation ID
     */
    const create_conversation = useCallback( async ( title, model_id, id_override ) => {

        const id = id_override || uuid()
        const now = Date.now()
        const conversation = {
            id,
            title: title.slice( 0, 100 ),
            created_at: now,
            updated_at: now,
            model_id: model_id || localStorage.getItem( active_model_key ) || ``,
        }

        const db = await get_db()
        await db.put( `conversations`, conversation )
        log.info( `[chat_history] Created conversation ${ id }` )
        await load_conversations()
        return id

    }, [ load_conversations ] )

    /**
     * Save a message to a conversation
     * @param {string} conversation_id - The conversation to save to
     * @param {Object} message - Message object with role, content, stats
     * @returns {Promise<string>} The message ID
     */
    const save_message = useCallback( async ( conversation_id, message ) => {

        const msg = {
            id: message.id || uuid(),
            conversation_id,
            role: message.role,
            content: message.content,
            created_at: message.created_at || Date.now(),
            stats: message.stats || null,
        }

        const db = await get_db()
        await db.put( `messages`, msg )
        log.debug( `[chat_history] Saved ${ msg.role } message to ${ conversation_id }` )

        // Update conversation timestamp
        const conversation = await db.get( `conversations`, conversation_id )
        if( conversation ) {
            conversation.updated_at = Date.now()
            await db.put( `conversations`, conversation )
        }

        return msg.id

    }, [] )

    /**
     * Load all messages for a conversation, sorted by created_at
     * @param {string} conversation_id
     * @returns {Promise<Array>} Messages array
     */
    const load_messages = useCallback( async ( conversation_id ) => {

        const db = await get_db()
        const all = await db.getAllFromIndex( `messages`, `conversation_id`, conversation_id )
        return all.sort( ( a, b ) => a.created_at - b.created_at )

    }, [] )

    /**
     * Delete a conversation and all its messages
     * @param {string} conversation_id
     * @returns {Promise<void>}
     */
    const delete_conversation = useCallback( async ( conversation_id ) => {

        log.info( `[chat_history] Deleting conversation ${ conversation_id }` )
        const db = await get_db()
        const tx = db.transaction( [ `conversations`, `messages` ], `readwrite` )

        // Delete all messages for this conversation
        const messages = await tx.objectStore( `messages` ).index( `conversation_id` ).getAll( conversation_id )
        for( const msg of messages ) {
            await tx.objectStore( `messages` ).delete( msg.id )
        }

        // Delete the conversation itself
        await tx.objectStore( `conversations` ).delete( conversation_id )
        await tx.done

        await load_conversations()

    }, [ load_conversations ] )

    /**
     * Delete all conversations and their messages.
     * Plain function (not useCallback) to avoid changing the hook count —
     * safe because load_conversations is a stable reference.
     * @returns {Promise<void>}
     */
    const delete_all_conversations = async () => {

        log.warn( `[chat_history] Deleting ALL conversations` )
        const db = await get_db()
        const tx = db.transaction( [ `conversations`, `messages` ], `readwrite` )
        await Promise.all( [
            tx.objectStore( `conversations` ).clear(),
            tx.objectStore( `messages` ).clear(),
            tx.done,
        ] )

        await load_conversations()

    }

    /**
     * Update conversation title
     * @param {string} conversation_id
     * @param {string} title
     * @returns {Promise<void>}
     */
    const update_title = useCallback( async ( conversation_id, title ) => {

        const db = await get_db()
        const conversation = await db.get( `conversations`, conversation_id )
        if( conversation ) {
            conversation.title = title.slice( 0, 100 )
            await db.put( `conversations`, conversation )
            await load_conversations()
        }

    }, [ load_conversations ] )

    /**
     * Clear all messages in a conversation and replace with new ones
     * Used when editing/regenerating truncates history
     * @param {string} conversation_id
     * @param {Array} messages - New message array
     * @returns {Promise<void>}
     */
    const replace_messages = useCallback( async ( conversation_id, messages ) => {

        const db = await get_db()
        const tx = db.transaction( `messages`, `readwrite` )
        const store = tx.objectStore( `messages` )

        // Delete existing messages for this conversation
        const existing = await store.index( `conversation_id` ).getAll( conversation_id )
        for( const msg of existing ) {
            await store.delete( msg.id )
        }

        // Save new messages
        for( const msg of messages ) {
            await store.put( {
                id: msg.id || uuid(),
                conversation_id,
                role: msg.role,
                content: msg.content,
                created_at: msg.created_at || Date.now(),
                stats: msg.stats || null,
            } )
        }

        await tx.done

    }, [] )

    return {
        conversations,
        is_loading,
        create_conversation,
        save_message,
        load_messages,
        delete_conversation,
        delete_all_conversations,
        update_title,
        replace_messages,
        refresh: load_conversations,
    }

}
