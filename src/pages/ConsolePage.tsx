import { useEffect, useRef, useCallback, useState } from 'react';

import { RealtimeClient, RealtimeUtils } from '@openai/realtime-api-beta';
import { ItemType, SystemItemType, UserItemType, AssistantItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
// noinspection ES6PreferShortImport
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';
import { instructions } from '../utils/conversation_config.js';
import { WavRenderer } from '../utils/wav_renderer';

import { X, Edit, Zap, ArrowUp, ArrowDown } from 'react-feather';
import { Button } from '../components/button/Button';

import './ConsolePage.scss';
import { clearInt16Arrays, getAllInt16Arrays, getInt16Array, upsertInt16Array } from '../utils/db.js';
import { disconnect } from 'process';
import { tavily } from '@tavily/core';

/**
 * Type for all event logs
 */
interface RealtimeEvent {
  time: string;
  source: 'client' | 'server';
  count?: number;
  event: { [key: string]: any };
}

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

export function ConsolePage() {
  const apiKey = localStorage.getItem('tmp::voice_api_key') || '';
  const tvly = tavily({ apiKey: "tvly-YOUR_API_KEY" });

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
  const eventsScrollHeightRef = useRef(0);
  const eventsScrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<string>(new Date().toISOString());

  /**
   * All of our variables for displaying application state
   * - items are all conversation items (dialog)
   * - realtimeEvents are event logs, which can be expanded
   * - memoryKv is for set_memory() function
   */

  // const [items, setItems] = useLocalStorage<ItemType[]>('items', []);
  const [items, setItems] = useState<ItemType[]>([]);
  // fallback because couldn't get it to work using items history and restoring the session.
  const [messageList, setMessageList] = useLocalStorage<{ id: string, sender: string, message: string }[]>('messageHistory', []);
  const [messageListCopy, setMessageListCopy] = useState<{ id: string, sender: string, message: string }[]>([]);
  useEffect(() => {
    setMessageListCopy(messageList);
  }, []);

  const [audioFiles, setAudioFiles] = useState<{ [id: string]: any }>({});

  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [expandedEvents, setExpandedEvents] = useState<{
    [key: string]: boolean;
  }>({});
  const [isConnected, setIsConnected] = useState(false);


  const getItemText = (item: ItemType) => {
    const text = (item.formatted.transcript ? item.formatted.transcript : item.formatted.text || '').trim();
    if (text.length == 0) {
      console.log('getItemText', { item });
      if ((item as any).content) { // SystemItemType|UserItemType|AssistantItemType
        return (item as any).content.map((c: any) => c.transcript).join('');
      }
    }
    return text;
  }

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
 * Utility for formatting the timing of logs
 */
  const formatTime = useCallback((timestamp: string) => {
    const startTime = startTimeRef.current;
    const t0 = new Date(startTime).valueOf();
    const t1 = new Date(timestamp).valueOf();
    const delta = t1 - t0;
    const hs = Math.floor(delta / 10) % 100;
    const s = Math.floor(delta / 1000) % 60;
    const m = Math.floor(delta / 60_000) % 60;
    const pad = (n: number) => {
      let s = n + '';
      while (s.length < 2) {
        s = '0' + s;
      }
      return s;
    };
    return `${pad(m)}:${pad(s)}.${pad(hs)}`;
  }, []);
  /**
   * Auto-scroll the event logs
   */
  useEffect(() => {
    if (eventsScrollRef.current) {
      const eventsEl = eventsScrollRef.current;
      const scrollHeight = eventsEl.scrollHeight;
      // Only scroll if height has just changed
      if (scrollHeight !== eventsScrollHeightRef.current) {
        eventsEl.scrollTop = scrollHeight;
        eventsScrollHeightRef.current = scrollHeight;
      }
    }
  }, [realtimeEvents]);

  /**
   * Connect to conversation:
   * WavRecorder taks speech input, WavStreamPlayer output, client is API client
   */
  const recordAudio = async (client: RealtimeClient, wavRecorder: WavRecorder, wavStreamPlayer: WavStreamPlayer) => {
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

        // 
        clientRef.current.disconnect();

        // Call connectConversation again
        await connectConversation(true);
        console.log('Reconnected client');
      }
    });
  };
  const connectConversation = useCallback(async (isReconnecting: boolean = false) => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;

    // Set state variables
    startTimeRef.current = new Date().toISOString();
    setIsConnected(true);

    await wavRecorder.begin();
    await wavStreamPlayer.connect();
    const connected = await client.connect();
    console.log('Connected to client', { connected });

    if (isReconnecting) {
      await recordAudio(client, wavRecorder, wavStreamPlayer);
      return;
    };
    const refreshStr = `Let's continue from the last conversation.`;
    if (messageList.length > 0) {
      const lastMessage = messageList[messageList.length - 1].message;
      const secondLastMessage = messageList.length > 1 ? messageList[messageList.length - 2].message : '';
      if (lastMessage.includes(refreshStr) || secondLastMessage.includes(refreshStr)) {
        await recordAudio(client, wavRecorder, wavStreamPlayer);
        return;
      }
    }

    if (messageList.length == 0) {
      client.sendUserMessageContent([
        {
          type: `input_text`,
          text: `Hey there!`,
        },
      ])
    } else {
      client.sendUserMessageContent([
        {
          type: `input_text`,
          text: `Let's continue from the last conversation.`,
        },
      ])
      // console.log('Found cached items, sending them to client', { items });
      // const itemsCopy = [...items];

      // Never receiving audio data why?

      // const audioData = await getAllInt16Arrays();
      // let previousItemId: string | undefined;
      // itemsCopy.forEach(async (item) => {
      //   console.log('Sending item to client', { id: item.id, role: item.role, prev_id: previousItemId, text: item.formatted.transcript || item.formatted.text });
      //   const text = item.formatted.transcript ? item.formatted.transcript : item.formatted.text || '';
      //   const audio = audioData[item.id];
      //   if (item.role == 'user') {
      //     if (audio && text) {
      //       addUserMessageAudio(item.id, audio, text, previousItemId);
      //     }
      //   } else if (text) {
      //     addAssistantMessageContent(item.id, text, previousItemId);
      //   }
      //   previousItemId = item.id;
      // });
      // setTimeout(() => {
      //   const updatedItems = client.conversation.getItems();
      //   console.log({ updatedItems });
      // }, 1000);

    }

    await recordAudio(client, wavRecorder, wavStreamPlayer);
  }, []);

  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    setIsConnected(false);

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

  /**
   * Add an assistant message to the conversation
   */
  const addAssistantMessageContent = (id: string, text: string, previousItemId: string | undefined) => {
    clientRef.current.realtime.send('conversation.item.create', {
      // event_id: id,
      // previous_item_id: previousItemId,
      item: {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'text', text: text }],
      },
    });
  }

  /**
   * Add a user message to the conversation
   */

  const addUserMessageAudio = (id: string, audio: Int16Array, text: string, previousItemId: string | undefined) => {
    console.log('~addUserMessageAudio', { id, text, previousItemId, audioLength: audio.length });
    clientRef.current.realtime.send('conversation.item.create', {
      // event_id: id,
      // previous_item_id: previousItemId,
      // TODO: user items are not receiving anything when sent after, so they are empty.
      // Thus they are cleared on 2nd reload.

      // audio not being sent ???
      item: {
        type: 'message',
        role: 'user',
        status: 'completed',
        content: [{ type: 'input_audio', audio: RealtimeUtils.arrayBufferToBase64(audio), transcript: text }],
        // content: [{ type: 'input_text', text: text }], 
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
  /**
    * Set up render loops for the visualization canvas
    */
  useEffect(() => {
    let isLoaded = true;

    const wavRecorder = wavRecorderRef.current;
    const clientCanvas = clientCanvasRef.current;
    let clientCtx: CanvasRenderingContext2D | null = null;

    const wavStreamPlayer = wavStreamPlayerRef.current;
    const serverCanvas = serverCanvasRef.current;
    let serverCtx: CanvasRenderingContext2D | null = null;

    const render = () => {
      if (isLoaded) {
        if (clientCanvas) {
          if (!clientCanvas.width || !clientCanvas.height) {
            clientCanvas.width = clientCanvas.offsetWidth;
            clientCanvas.height = clientCanvas.offsetHeight;
          }
          clientCtx = clientCtx || clientCanvas.getContext('2d');
          if (clientCtx) {
            clientCtx.clearRect(0, 0, clientCanvas.width, clientCanvas.height);
            const result = wavRecorder.recording
              ? wavRecorder.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              clientCanvas,
              clientCtx,
              result.values,
              '#0099ff',
              10,
              0,
              8
            );
          }
        }
        if (serverCanvas) {
          if (!serverCanvas.width || !serverCanvas.height) {
            serverCanvas.width = serverCanvas.offsetWidth;
            serverCanvas.height = serverCanvas.offsetHeight;
          }
          serverCtx = serverCtx || serverCanvas.getContext('2d');
          if (serverCtx) {
            serverCtx.clearRect(0, 0, serverCanvas.width, serverCanvas.height);
            const result = wavStreamPlayer.analyser
              ? wavStreamPlayer.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              serverCanvas,
              serverCtx,
              result.values,
              '#009900',
              10,
              0,
              8
            );
          }
        }
        window.requestAnimationFrame(render);
      }
    };
    render();

    return () => {
      isLoaded = false;
    };
  }, []);

  /**
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, tools, events and more
   */
  const setupSession = (client: RealtimeClient, wavStreamPlayer: WavStreamPlayer) => {
    let instructionsCopy = instructions;
    if (messageList.length > 0) {
      instructionsCopy = instructionsCopy + `\n\nThe following is a history of our previous conversation:\n${messageList.map(message => `${message.sender}: ${message.message}`).join('\n')}`;
    }
    // Set instructions
    client.updateSession({
      instructions: instructionsCopy,
      input_audio_transcription: { model: 'whisper-1' },
      turn_detection: { type: 'server_vad' }
    });
    client.addTool(
      {
        name: 'search_web',
        description: 'Searches the web for up to date information, beyond your training data available.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                'The key of the memory value. Always use lowercase and underscores, no other characters.',
            },
            value: {
              type: 'string',
              description: 'Value can be anything represented as a string',
            },
          },
          required: ['key', 'value'],
        },
      },
      async ({ key, value }: { [key: string]: any }) => {
        // Step 1. Instantiating your Tavily client
        const tvly = tavily({ apiKey: "tvly-YOUR_API_KEY" });

        // Step 2. Executing a Q&A search query
        // const answer = tvly.searchQNA("Who is Leo Messi?");
        return { ok: true };
      }
    );

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
      const latestItems = client.conversation.getItems();
      const lastIsIncomplete = (latestItems[latestItems.length - 1] as any).status === 'incomplete';
      if (lastIsIncomplete) {
        console.log('items', { items });
        console.log('latestItem', { item: latestItems[latestItems.length - 1] });
      }

      if (delta?.audio) {
        wavStreamPlayer.add16BitPCM(delta.audio, item.id);
      }
      if (item.status === 'completed' && item.formatted.audio?.length) {
        const wavFile = await WavRecorder.decode(
          item.formatted.audio,
          24000,
          24000
        );
        // item.formatted.file = wavFile;
        setAudioFiles((prevAudioFiles) => ({
          ...prevAudioFiles,
          [item.id]: wavFile,
        }));
      }
      const itemsWithoutAudio = latestItems.map(item => {
        const { formatted, ...rest } = item;
        return { ...rest, formatted: { ...formatted, audio: undefined, file: undefined } };
      });
      setItems(itemsWithoutAudio);


      setMessageList((prevMessageList) => {
        const updatedMessageList = [...prevMessageList];

        latestItems.forEach((item) => {
          const existingIndex = updatedMessageList.findIndex(
            (message) => message.id === item.id
          );

          const newMessage: { id: string, sender: string, message: string } = {
            id: item.id,
            sender: item.role!,
            message: getItemText(item),
          };

          if (newMessage.message.length > 0) {
            if (existingIndex !== -1) {
              updatedMessageList[existingIndex] = newMessage;
            } else {
              updatedMessageList.push(newMessage);
            }
          }
        });

        return updatedMessageList;
      });
      // items.forEach(async (item) => {
      //   if (item.formatted.audio && item.formatted.audio.length) {
      //     try {
      //       await upsertInt16Array(item.id, item.formatted.audio);
      //       // console.log(`Audio for item ${item.id} upserted successfully.`);
      //     } catch (error) {
      //       console.error(`Failed to upsert audio for item ${item.id}:`, error);
      //     }
      //   }
      // });

    });

  }

  /**
   * Setup session on mount
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

  const clearData = async () => {
    copyConversation();
    setItems([]);
    setMessageList([]);
    try {
      await clearInt16Arrays();
      console.log('IndexedDB data cleared successfully.');
      window.location.reload();
    } catch (error) {
      console.error('Failed to clear IndexedDB data:', error);
    }
  };

  const copyConversation = () => {
    const messages = messageList.map(message => `${message.sender}: ${message.message}`);
    navigator.clipboard.writeText(messages.join('\n'));
  }

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
          {/* <div className="content-block events">
            <div className="visualization">
              <div className="visualization-entry client">
                <canvas ref={clientCanvasRef} />
              </div>
              <div className="visualization-entry server">
                <canvas ref={serverCanvasRef} />
              </div>
            </div>
            <div className="content-block-title">events</div>
            <div className="content-block-body" ref={eventsScrollRef}>
              {!realtimeEvents.length && `awaiting connection...`}
              {realtimeEvents.map((realtimeEvent, i) => {
                const count = realtimeEvent.count;
                const event = { ...realtimeEvent.event };
                if (event.type === 'input_audio_buffer.append') {
                  event.audio = `[trimmed: ${event.audio.length} bytes]`;
                } else if (event.type === 'response.audio.delta') {
                  event.delta = `[trimmed: ${event.delta.length} bytes]`;
                }
                return (
                  <div className="event" key={event.event_id}>
                    <div className="event-timestamp">
                      {formatTime(realtimeEvent.time)}
                    </div>
                    <div className="event-details">
                      <div
                        className="event-summary"
                        onClick={() => {
                          // toggle event details
                          const id = event.event_id;
                          const expanded = { ...expandedEvents };
                          if (expanded[id]) {
                            delete expanded[id];
                          } else {
                            expanded[id] = true;
                          }
                          setExpandedEvents(expanded);
                        }}
                      >
                        <div
                          className={`event-source ${event.type === 'error'
                            ? 'error'
                            : realtimeEvent.source
                            }`}
                        >
                          {realtimeEvent.source === 'client' ? (
                            <ArrowUp />
                          ) : (
                            <ArrowDown />
                          )}
                          <span>
                            {event.type === 'error'
                              ? 'error!'
                              : realtimeEvent.source}
                          </span>
                        </div>
                        <div className="event-type">
                          {event.type}
                          {count && ` (${count})`}
                        </div>
                      </div>
                      {!!expandedEvents[event.event_id] && (
                        <div className="event-payload">
                          {JSON.stringify(event, null, 2)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div> */}
          <div className="content-block events">
            <div className="content-block-title">conversation</div>
            <div className="content-block-body" data-conversation-content>
              {messageListCopy.length && <div style={{ marginBottom: '8px', marginTop: '8px' }}>Previous conversation:</div>}
              {messageListCopy.length && <div style={{ marginBottom: '32px' }}>
                {messageListCopy.map((message: { id: string, sender: string, message: string }) => (
                  <div className="conversation-item" key={message.id}>
                    <div className={`speaker ${message.sender || ''}`}>
                      <div>
                        {message.sender}
                      </div>
                    </div>
                    <div className={`speaker-content`}>
                      {message.message}
                    </div>
                  </div>
                ))}
              </div>}
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
                            {getItemText(conversationItem) || '(truncated)'}
                          </div>
                        )}

                      {audioFiles[conversationItem.id] && conversationItem.role === 'assistant' && (
                        <audio
                          src={audioFiles[conversationItem.id].url}
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
            <Button
              label={isConnected ? 'disconnect' : 'connect'}
              iconPosition={isConnected ? 'end' : 'start'}
              icon={isConnected ? X : Zap}
              buttonStyle={isConnected ? 'regular' : 'action'}
              onClick={
                isConnected ? disconnectConversation : () => connectConversation(false)
              }
            />
            <div className="spacer" />
            <div>
              <div className="visualization">
                <div className="visualization-entry client">
                  <canvas ref={clientCanvasRef} />
                </div>
                <div className="visualization-entry server">
                  <canvas ref={serverCanvasRef} />
                </div>
              </div>
            </div>
            <div className="spacer" />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Button
                label="Clear and start new"
                iconPosition="start"
                icon={X}
                buttonStyle="alert"
                onClick={clearData}
              />
              <Button
                label="Copy conversation"
                iconPosition="start"
                icon={Zap}
                buttonStyle="action"
                style={{ marginTop: '8px' }}
                onClick={copyConversation}
              />
            </div>
            <div />
          </div>
        </div>
      </div>
    </div>
  );
}
