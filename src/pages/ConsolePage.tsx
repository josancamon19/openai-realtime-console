import { useEffect, useRef, useCallback, useState } from 'react';

import { RealtimeClient, RealtimeUtils } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
// noinspection ES6PreferShortImport
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';
import { instructions } from '../utils/conversation_config.js';
import { WavRenderer } from '../utils/wav_renderer';

import { X, Edit, Zap } from 'react-feather';
import { Button } from '../components/button/Button';

import './ConsolePage.scss';
import { clearInt16Arrays, getAllInt16Arrays, getInt16Array, upsertInt16Array } from '../utils/db.js';
import { disconnect } from 'process';

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
  // const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  // const serverCanvasRef = useRef<HTMLCanvasElement>(null);
  const startTimeRef = useRef<string>(new Date().toISOString());

  /**
   * All of our variables for displaying application state
   * - items are all conversation items (dialog)
   * - realtimeEvents are event logs, which can be expanded
   * - memoryKv is for set_memory() function
   */

  const [items, setItems] = useLocalStorage<ItemType[]>('items', []);
  const [audioFiles, setAudioFiles] = useState<{ [id: string]: any }>({});

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

    await wavRecorder.begin();
    await wavStreamPlayer.connect();
    await client.connect();

    if (items.length == 0) {
      client.sendUserMessageContent([
        {
          type: `input_text`,
          text: `Hey there!`,
        },
      ])
    } else {
      console.log('Found cached items, sending them to client', { items });
      const itemsCopy = [...items];

      const audioData = await getAllInt16Arrays();
      let previousItemId: string | undefined;
      itemsCopy.forEach(async (item) => {
        console.log('Sending item to client', { id: item.id, role: item.role, prev_id: previousItemId, text: item.formatted.transcript || item.formatted.text });
        const text = item.formatted.transcript ? item.formatted.transcript : item.formatted.text || '';
        const audio = audioData[item.id];
        if (item.role == 'user') {
          if (audio && text) {
            addUserMessageAudio(item.id, audio, text, previousItemId);
          }
        } else if (text) {
          addAssistantMessageContent(item.id, text, previousItemId);
        }
        previousItemId = item.id;
      });
      setTimeout(() => {
        const updatedItems = client.conversation.getItems();
        console.log({ updatedItems });
      }, 3000);

      // ask it to continue from last conversation
    }

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

          // 
          clientRef.current.disconnect();

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
    console.log('addUserMessageAudio', { id, text, previousItemId, audioLength: audio.length });
    const audioBase64 = RealtimeUtils.arrayBufferToBase64(audio);
    clientRef.current.realtime.send('conversation.item.create', {
      // event_id: id,
      // previous_item_id: previousItemId,
      // TODO: user items are not receiving anything when sent after, thus they are empty. Thus they are cleared on 2nd reload.
      item: {
        type: 'message',
        role: 'user',
        status: 'completed',
        content: [{ type: 'input_audio', audio: audioBase64 }], // transcript: text
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
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, tools, events and more
   */
  const setupSession = (client: RealtimeClient, wavStreamPlayer: WavStreamPlayer) => {

    // Set instructions
    client.updateSession({
      instructions: instructions,
      input_audio_transcription: { model: 'whisper-1' },
      turn_detection: { type: 'server_vad' }
    });

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
      const itemsWithoutAudio = items.map(item => {
        const { formatted, ...rest } = item;
        return { ...rest, formatted: { ...formatted, audio: undefined, file: undefined } };
      });
      setItems(itemsWithoutAudio);
      items.forEach(async (item) => {
        if (item.formatted.audio && item.formatted.audio.length) {
          try {
            await upsertInt16Array(item.id, item.formatted.audio);
            // console.log(`Audio for item ${item.id} upserted successfully.`);
          } catch (error) {
            console.error(`Failed to upsert audio for item ${item.id}:`, error);
          }
        }
      });

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
    setItems([]);
    try {
      await clearInt16Arrays();
      console.log('IndexedDB data cleared successfully.');
      window.location.reload();
    } catch (error) {
      console.error('Failed to clear IndexedDB data:', error);
    }
  };

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
                isConnected ? disconnectConversation : connectConversation
              }
            />
            <div className="spacer" />
            <Button
              label="clear"
              iconPosition="start"
              icon={X}
              buttonStyle="alert"
              onClick={clearData}
            />
            <div />
          </div>
        </div>
      </div>
    </div>
  );
}
