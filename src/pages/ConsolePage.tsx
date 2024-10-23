import { useEffect, useRef, useCallback, useState } from 'react';

import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
// noinspection ES6PreferShortImport
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';
import { instructions } from '../utils/conversation_config.js';
import { WavRenderer } from '../utils/wav_renderer';

import { X, Edit, Zap } from 'react-feather';
import { Button } from '../components/button/Button';

import './ConsolePage.scss';

/**
 * Type for all event logs
 */
interface RealtimeEvent {
  time: string;
  source: 'client' | 'server';
  count?: number;
  event: { [key: string]: any };
}

export function ConsolePage() {
  const apiKey = localStorage.getItem('tmp::voice_api_key') || '';

  /**
   * Instantiate:
   * - WavRecorder (speech input)
   * - WavStreamPlayer (speech output)
   * - RealtimeClient (API client)
   */
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );
  const wavStreamPlayerRef = useRef<WavStreamPlayer>(
    new WavStreamPlayer({ sampleRate: 24000 })
  );
  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient({
      apiKey: apiKey,
      dangerouslyAllowAPIKeyInBrowser: true,
    })
  );

  /**
   * References for
   * - Rendering audio visualization (canvas)
   * - Autoscrolling event logs
   * - Timing delta for event log displays
   */
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const serverCanvasRef = useRef<HTMLCanvasElement>(null);
  const startTimeRef = useRef<string>(new Date().toISOString());

  /**
   * All of our variables for displaying application state
   * - items are all conversation items (dialog)
   * - realtimeEvents are event logs, which can be expanded
   * - memoryKv is for set_memory() function
   */
  // Hook to manage local storage
  function useLocalStorage<T>(key: string, initialValue: T) {
    const [storedValue, setStoredValue] = useState<T>(() => {
      try {
        const item = window.localStorage.getItem(key);
        return item ? JSON.parse(item) : initialValue;
      } catch (error) {
        console.error('Error reading localStorage key:', key, error);
        return initialValue;
      }
    });

    const setValue = (value: T | ((val: T) => T)) => {
      try {
        const valueToStore = value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      } catch (error) {
        console.error('Error setting localStorage key:', key, error);
      }
    };

    return [storedValue, setValue] as const;
  }

  const [items, setItems] = useLocalStorage<ItemType[]>('items',[]);
  // Cached items with "role" and "text" value
  const [cachedItems, setCachedItems] = useLocalStorage<{ id: string; role: string; text: string }[]>(
    'cachedItems',
    []
  );

  const [_, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  /**
   * When you click the API key
   */
  const resetAPIKey = useCallback(() => {
    const apiKey = prompt('OpenAI API Key');
    if (apiKey !== null) {
      localStorage.clear();
      localStorage.setItem('tmp::voice_api_key', apiKey);
      window.location.reload();
    }
  }, []);

  /**
   * Connect to conversation:
   * WavRecorder taks speech input, WavStreamPlayer output, client is API client
   */
  const connectConversation = useCallback(async () => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;

    // Set state variables
    startTimeRef.current = new Date().toISOString();
    setIsConnected(true);
    setItems(client.conversation.getItems());

    // Connect to microphone
    await wavRecorder.begin();

    // Connect to audio output
    await wavStreamPlayer.connect();

    // Connect to realtime API
    await client.connect();
    client.sendUserMessageContent([
      {
        type: `input_text`,
        text: `Hello!`,
      },
    ]);

    const recordAudio = async () => {
      await wavRecorder.record(async (data) => {
        try {
          client.appendInputAudio(data.mono);
        } catch (error) {
          console.error('Error appending input audio:', error);
          console.log('Client state:', { isConnected: client.isConnected() });
          console.log('Reinitializing client and reconnecting...');

          // Finish current wav recorder
          await wavRecorder.end();
          await wavStreamPlayer.interrupt();
          console.log('Interrupted wavStreamPlayer');

          // Create a new client
          clientRef.current = new RealtimeClient({
            apiKey: apiKey,
            dangerouslyAllowAPIKeyInBrowser: true,
          });

          // Call connectConversation again
          await connectConversation();
          console.log('Reconnected client');
        }
      });
    };

    await recordAudio();
  }, []);

  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    setIsConnected(false);
    setItems([]);

    const client = clientRef.current;
    client.disconnect();

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.end();

    const wavStreamPlayer = wavStreamPlayerRef.current;
    await wavStreamPlayer.interrupt();
  }, []);

  const deleteConversationItem = useCallback(async (id: string) => {
    const client = clientRef.current;
    client.deleteItem(id);
  }, []);

  const addAssistantMessageContent = (text: string) => {
    clientRef.current.realtime.send('conversation.item.create', {
      item: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: text }],
      },
    });
  }

  const addUserMessageContent = (text: string) => {
    clientRef.current.realtime.send('conversation.item.create', {
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: text }],
      },
    });
  }

  /**
   * Auto-scroll the conversation logs
   */
  useEffect(() => {
    const conversationEls = [].slice.call(
      document.body.querySelectorAll('[data-conversation-content]')
    );
    for (const el of conversationEls) {
      const conversationEl = el as HTMLDivElement;
      conversationEl.scrollTop = conversationEl.scrollHeight;
    }
  }, [items]);

  const setupSession = (client: RealtimeClient, wavStreamPlayer: WavStreamPlayer) => {

    // Set instructions
    client.updateSession({ instructions: instructions });
    // Set transcription, otherwise we don't get user transcriptions back
    client.updateSession({ input_audio_transcription: { model: 'whisper-1' } });
    // Set turn detection to server VAD
    client.updateSession({ turn_detection: { type: 'server_vad' } })

    // handle realtime events from client + server for event logging
    client.on('realtime.event', (realtimeEvent: RealtimeEvent) => {
      setRealtimeEvents((realtimeEvents) => {
        const lastEvent = realtimeEvents[realtimeEvents.length - 1];
        if (lastEvent?.event.type === realtimeEvent.event.type) {
          // if we receive multiple events in a row, aggregate them for display purposes
          lastEvent.count = (lastEvent.count || 0) + 1;
          return realtimeEvents.slice(0, -1).concat(lastEvent);
        } else {
          return realtimeEvents.concat(realtimeEvent);
        }
      });
    });

    client.on('error', (event: any) => console.error(event));
    client.on('conversation.interrupted', async () => {
      const trackSampleOffset = await wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        await client.cancelResponse(trackId, offset);
      }
    });

    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      // console.log({ items });
      if (delta?.audio) {
        wavStreamPlayer.add16BitPCM(delta.audio, item.id);
      }
      if (item.status === 'completed' && item.formatted.audio?.length) {
        const wavFile = await WavRecorder.decode(
          item.formatted.audio,
          24000,
          24000
        );
        item.formatted.file = wavFile;
      }
      setItems(items);
      setCachedItems((prevItems: { id: string; role: string; text: string }[]) => {
        const updatedItems = items.reduce((acc, currentItem) => {
          const index = acc.findIndex(item => item.id === currentItem.id);
          if (index !== -1) {
            acc[index] = {
              id: currentItem.id,
              role: currentItem.role!,
              text: currentItem.formatted.transcript ? currentItem.formatted.transcript : currentItem.formatted.text || ''
            }; // Replace existing item with the same id
          } else {
            acc.push({
              id: currentItem.id,
              role: currentItem.role!,
              text: currentItem.formatted.transcript ? currentItem.formatted.transcript : currentItem.formatted.text || ''
            }); // Add new item
          }
          return acc;
        }, [...prevItems]); // Start with previous items
        return updatedItems;
      });
    });

    setItems(client.conversation.getItems());
  }

  /**
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, tools, events and more
   */
  useEffect(() => {
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const client = clientRef.current;
    setupSession(client, wavStreamPlayer);

    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  }, []);

  /**
   * Render the application
   */
  return (
    <div data-component="ConsolePage">
      <div className="content-top">
        <div className="content-title">
          <img src="/openai-logomark.svg" alt="" />
          <span>realtime console</span>
        </div>
        <div className="content-api-key">
          <Button
            icon={Edit}
            iconPosition="end"
            buttonStyle="flush"
            label={`api key: ${apiKey.slice(0, 3)}...`}
            onClick={() => resetAPIKey()}
          />
        </div>
      </div>
      <div className="content-main">
        <div className="content-logs">
          <div className="content-block events">
            <div className="content-block-title">conversation</div>
            <div className="content-block-body" data-conversation-content>
              {!items.length && `awaiting connection...`}
              {items.map((conversationItem, i) => {
                return (
                  <div className="conversation-item" key={conversationItem.id}>
                    <div className={`speaker ${conversationItem.role || ''}`}>
                      <div>
                        {(
                          conversationItem.role || conversationItem.type
                        ).replaceAll('_', ' ')}
                      </div>
                      <div
                        className="close"
                        onClick={() =>
                          deleteConversationItem(conversationItem.id)
                        }
                      >
                        <X />
                      </div>
                    </div>
                    <div className={`speaker-content`}>
                      {/* tool response */}
                      {conversationItem.type === 'function_call_output' && (
                        <div>{conversationItem.formatted.output}</div>
                      )}
                      {/* tool call */}
                      {!!conversationItem.formatted.tool && (
                        <div>
                          {conversationItem.formatted.tool.name}(
                          {conversationItem.formatted.tool.arguments})
                        </div>
                      )}
                      {!conversationItem.formatted.tool &&
                        conversationItem.role === 'user' && (
                          <div>
                            {conversationItem.formatted.transcript ||
                              (conversationItem.formatted.audio?.length
                                ? '(awaiting transcript)'
                                : conversationItem.formatted.text ||
                                '(item sent)')}
                          </div>
                        )}
                      {!conversationItem.formatted.tool &&
                        conversationItem.role === 'assistant' && (
                          <div>
                            {conversationItem.formatted.transcript ||
                              conversationItem.formatted.text ||
                              '(truncated)'}
                          </div>
                        )}

                      {conversationItem.formatted.file && conversationItem.role === 'assistant' && (
                        <audio
                          src={conversationItem.formatted.file.url}
                          controls
                          style={{ paddingTop: '12px' }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="content-actions">
            {/*<Toggle*/}
            {/*  defaultValue={false}*/}
            {/*  labels={['manual', 'vad']}*/}
            {/*  values={['none', 'server_vad']}*/}
            {/*  onChange={(_, value) => changeTurnEndType(value)}*/}
            {/*/>*/}
            {/*<div className="spacer" />*/}
            {/*{isConnected && canPushToTalk && (*/}
            {/*  <Button*/}
            {/*    label={isRecording ? 'release to send' : 'push to talk'}*/}
            {/*    buttonStyle={isRecording ? 'alert' : 'regular'}*/}
            {/*    disabled={!isConnected || !canPushToTalk}*/}
            {/*    onMouseDown={startRecording}*/}
            {/*    onMouseUp={stopRecording}*/}
            {/*  />*/}
            {/*)}*/}
            <div className="spacer" />
            <Button
              label={isConnected ? 'disconnect' : 'connect'}
              iconPosition={isConnected ? 'end' : 'start'}
              icon={isConnected ? X : Zap}
              buttonStyle={isConnected ? 'regular' : 'action'}
              onClick={
                isConnected ? disconnectConversation : connectConversation
              }
            />
            <div className="spacer" />
          </div>
        </div>
      </div>
    </div>
  );
}
