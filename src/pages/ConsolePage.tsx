import { useEffect, useRef, useCallback, useState } from 'react';

import { RealtimeClient, RealtimeUtils } from '@openai/realtime-api-beta';
import { ItemType, SystemItemType, UserItemType, AssistantItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
// noinspection ES6PreferShortImport
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';
import { instructions } from '../utils/conversation_config.js';
import { WavRenderer } from '../utils/wav_renderer';

import { X, Edit, Zap, ArrowUp, ArrowDown, MessageCircle, Copy, Settings, RefreshCw } from 'react-feather';
import { Button } from '../components/button/Button';

import { tavily } from '@tavily/core';
import { useNavigate } from 'react-router-dom';

import OpenAI from 'openai';
import mermaid from 'mermaid';
import { ZoomableDiv } from '../components/ZoomableDiv';
import { useLocalStorage } from '../utils/local_storage_hook';
import Header from '../components/Header';

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
  const apiKey = (localStorage.getItem('tmp::voice_api_key') || '').replaceAll('"', '');

  const navigate = useNavigate();
  const searchParams = new URLSearchParams(window.location.search);
  const topicUuid = searchParams.get('uuid') || '123';
  const [topic, setTopic] = useState<{ title: string; uuid: string } | null>(null);

  useEffect(() => {
    if (topicUuid) {
      const storedTopics = JSON.parse(localStorage.getItem('topics') || '[]') || [];
      const topic = storedTopics.find((topic: { uuid: string }) => topic.uuid === topicUuid);
      // console.log('topic', { topic });
      if (!topic) {
        navigate('/');
      } else {
        setTopic(topic);
      }
    } else {
      navigate('/');
    }
  }, []);

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
      // debug: true,
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
   */

  const [items, setItems] = useState<ItemType[]>([]);
  const [messageList, setMessageList] = useLocalStorage<{ id: string, sender: string, message: string }[]>(`${topicUuid}::messageHistory`, []);
  const [messageListCopy, setMessageListCopy] = useState<{ id: string, sender: string, message: string }[]>([]);

  useEffect(() => {
    setMessageListCopy(messageList);
  }, []);

  const [audioFiles, setAudioFiles] = useState<{ [id: string]: any }>({});

  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);

  const [isConnected, setIsConnected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [mermaidGraph, setMermaidGraph] = useLocalStorage<string>(`${topicUuid}::mermaidGraph`, '');
  const [lastMermaidGraphMessageId, setLastMermaidGraphMessageId] = useState<string | null>(null);
  const [isGeneratingMermaidGraph, setIsGeneratingMermaidGraph] = useState(false);

  const getItemRole = (item: ItemType | any) => {
    const role = item.role || item.sender;
    if (role) {
      return role === 'user' ? 'you' : 'assistant';
    }
    return item.type.replaceAll('_', ' ');
  }

  // const [mostRecentImage, setMostRecentImage] = useState<string | null>(null);
  // const [isGeneratingImage, setIsGeneratingImage] = useState(false);


  // const generateImage = async () => {
  //   if (isGeneratingImage) return;
  //   setIsGeneratingImage(true);
  //   const openai = new OpenAI({ apiKey: apiKey, dangerouslyAllowBrowser: true });
  //   const recentMessages = messageList.slice(-5);

  //   const completion = await openai.chat.completions.create({
  //     messages: [{
  //       role: "system", content: `
  //       Based on the following study topic: ${topic!.title}
  //       And from the last ${recentMessages.length} messages of the teacher-student conversation:
  //       \`\`\`
  //       ${recentMessages.map((message) => `${message.sender}: ${message.message}`).join('\n')}
  //       \`\`\`
  //       Generate a prompt with the following format:
  //       "Create an minimalistic illustration for explaining [concept]. Show [key element 1], [key element 2], and [key element 3] using [visual metaphor]. Use arrows to indicate [relationship]. Label each part clearly. Style should be minimalistic, clean, colorless, and easy to understand."
  //       ` }],
  //     model: "gpt-4o",
  //   });
  //   const prompt = completion.choices[0].message.content!;
  //   console.log('dallee prompt', { prompt });
  //   const image = await openai.images.generate({ model: "dall-e-3", prompt: prompt });

  //   console.log({ images: image.data });
  //   setMostRecentImage(image.data[0].url!);
  //   setIsGeneratingImage(false);
  // };

  const generateFollowUpQuestions = async () => {
    const openai = new OpenAI({ apiKey: apiKey, dangerouslyAllowBrowser: true });
    const completion = await openai.chat.completions.create({
      response_format: { type: 'json_object' },
      messages: [{
        role: "system", content: `
        You will be given an on-going conversation between a teacher and a student.

        Your job is to ask as a student, and generate 3 follow up questions that can be asked to the teacher for better understanding of the topic.

        Your questions should be concise and to the point.

        Conversation:
        \`\`\`
        ${messageList.map((message) => `${message.sender === 'user' ? 'Student' : 'Teacher'}: ${message.message}`).join('\n')}
        \`\`\`

        Your response should be in the following JSON format:
        \`\`\`
        [
          "Question 1",
          "Question 2",
          "Question 3"
        ]
        \`\`\`
        ` }],
      model: "gpt-4o",
    });
    const content = completion.choices[0].message.content!;
    try {
      const questions = JSON.parse(content);
      console.log('questions', { questions });
    } catch (e) {
      console.error('Error parsing JSON:', e);
    }
  }

  const generateMermaidGraph = async () => {
    if (isGeneratingMermaidGraph) return;
    setIsGeneratingMermaidGraph(true);

    const openai = new OpenAI({ apiKey: apiKey, dangerouslyAllowBrowser: true });
    // ${mermaidGraph ? `Make sure to use as the starting point, the previous mermaid graph and update it with any new information (if any):
    // \`\`\`
    // ${mermaidGraph}
    // \`\`\`
    // ` : ''}
    const completion = await openai.chat.completions.create({
      messages: [{
        role: "system", content: `
        Generate mermaid code (graph) for the following transcript of a study conversation:
        Ignore any messages that are not related to the study topic: "${topic!.title}"

        Make sure the chart shows the relationships between all the concepts learned. The simpler the better.
        Do not expand the graph beyond things not mentioned in the conversation.
        
        Conversation:
        \`\`\`
        ${messageList.map((message) => `${message.sender === 'user' ? 'Student' : 'Teacher'}: ${message.message}`).join('\n')}
        \`\`\`

        Make sure to include in the graph the relationships between the concepts.
        Example: "Traditional_Practices -->|Example| Tea_Ceremonies"
        ` }],
      model: "gpt-4o",
    });
    const content = completion.choices[0].message.content!;
    const regex = /```([^`]+)```/;
    const match = content.match(regex);
    const extractedContent = (match ? match[1].trim() : '').replaceAll('"', '').replaceAll('mermaid', '').trim();
    console.log('extracted mermaid graph:', { extractedContent });
    setMermaidGraph('');
    setTimeout(() => {
      setMermaidGraph(extractedContent);
      setIsGeneratingMermaidGraph(false);
    }, 500);
  };

  const drawDiagram = async function () {
    const mermaidElement = document.getElementById('mermaid-graph');
    if (!mermaidElement) return;
    const { svg } = await mermaid.render('mermaid-graph', mermaidGraph);
    console.log('svg', { svg, mermaidElement });
    mermaidElement!.innerHTML = svg;
  };

  useEffect(() => {
    console.log('refreshing mermaidGraph', { mermaidGraph });
    const mermaidElement = document.getElementById('mermaid-graph');
    console.log('mermaidElement', { mermaidElement });
    if (mermaidElement) {
      try {
        mermaid.run({ nodes: [mermaidElement], suppressErrors: true, });
      } catch (e) {
        console.error('Error running mermaid:', e);
      }
    } else {
      console.warn('Mermaid graph element not found');
    }
    // drawDiagram();
  }, [mermaidGraph]);

  const [lastGeneratedCount, setLastGeneratedCount] = useState(0);

  useEffect(() => {
    if (topic && messageList.length > 0 && messageList.length % 5 === 0 && window.innerWidth > 768 && messageList.length > lastGeneratedCount) {
      generateMermaidGraph();
      setLastGeneratedCount(messageList.length);
    }
  }, [messageList]);


  const getItemText = (item: ItemType) => {
    const text = (item.formatted.transcript ? item.formatted.transcript : item.formatted.text || '').trim();
    if (text.length == 0) {
      if ((item as any).content) { // SystemItemType|UserItemType|AssistantItemType
        return (item as any).content.map((c: any) => c.transcript).join('');
      }
    }
    return text;
  }

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
    instructionsCopy = instructionsCopy + `\n\nThe following is the current topic of interest:\n${topic!.title}`;

    client.updateSession({
      instructions: instructionsCopy,
      input_audio_transcription: { model: 'whisper-1' },
      turn_detection: { type: 'server_vad' }
    });
    client.addTool(
      {
        name: 'search_web',
        description: 'Searches the web for up to date information, use when asked beyond your training data available, or when asked about current events.',
        parameters: {
          type: 'object',
          properties: {
            search: {
              type: 'string',
              description:
                'The search query to search the web with. Example: "What is the weather in Tokyo?"',
            },
          },
          required: ['search'],
        },
      },
      async ({ search }: { [search: string]: any }) => {
        console.log('search_web', { search });
        try {
          const tavilyApiKey = localStorage.getItem('tmp::tvly_api_key') || '';
          const tvly = tavily({ apiKey: tavilyApiKey });
          const answer = await tvly.searchQNA(search, {
            searchDepth: 'basic',
            topic: 'general',
            maxResults: 5,
          });
          console.log('search_web answer', { answer });
          return { "result": answer };
        } catch (e) {
          return { "result": "Don't have access to web searches, check your API Key." }
        }
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
      const cleanedItems = latestItems.reduce<ItemType[]>((acc, item) => {
        // TODO: skip empty ones
        // TODO: make sure joins are working
        const { formatted, ...rest } = item;
        const newItem: ItemType = { ...rest, formatted: { ...formatted, audio: undefined, file: undefined } };

        if (acc.length > 0) {
          const lastItem = acc[acc.length - 1];

          // Join if both user messages or both assistant messages
          if ((lastItem.role === 'user' && newItem.role === 'user') ||
            (lastItem.role === 'assistant' && newItem.role === 'assistant')) {
            lastItem.formatted.transcript = `${getItemText(lastItem)} ${getItemText(newItem)}`.trim();
            lastItem.formatted.text = lastItem.formatted.transcript;
            return acc;
          }
        }

        return [...acc, newItem];
      }, []);
      setItems(cleanedItems);

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
    if (topic == null) return;
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const client = clientRef.current;
    setupSession(client, wavStreamPlayer);

    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  }, [topic]);

  const clearData = async () => {
    copyConversation();
    setItems([]);
    setMessageList([]);
    setMessageListCopy([]);

    try {
      // await clearInt16Arrays();
      console.log('IndexedDB data cleared successfully.');
      window.location.reload();
    } catch (error) {
      console.error('Failed to clear IndexedDB data:', error);
    }
  };

  const openInChatGPT = async () => {
    // TODO: get messages string function, instead of "sender" use student/teacher
    const messages = messageList.map(message => `${message.sender}: ${message.message}\n`);
    const conversation = messages.join('\n\n');

    const prompt = `
    You will review the transcript of a conversation between a student and a teacher, with the title of: "${topic?.title}".
    Your task is to help the user solve any questions they may have about the conversation.
    Additionally, you will provide corrections, further topics of interest for the student.
    Here is the transcript of the conversation:

    \`\`\`
    ${conversation}
    \`\`\`

    If you understand the instructions, and have a clear idea of the conversation, respond with: "Hey 👋!\nWhat can I help you understand better todat?"
    `.trim();
    window.open(`https://chatgpt.com/?q=${prompt}`, '_blank');
  };

  const copyConversation = () => {
    const messages = messageList.map(message => `${message.sender}: ${message.message}`);
    navigator.clipboard.writeText(messages.join('\n'));
  }

  /**
   * Render the application
   */
  return (
    <div data-component="ConsolePage" className="font-roboto-mono font-normal text-xs h-full flex flex-col overflow-hidden mx-2">
      {/* Header */}
      <Header
        title={topic?.title || ''}
        onNavigateBack={() => navigate('/')}
      />

      {/* Conversation */}
      <div className={`flex-grow flex flex-col ${window.innerWidth < 768 ? 'w-full' : 'w-1/2 border-r border-gray-300'} mt-16 pl-2 pr-8  relative max-h-full mb-20 text-[#8e8e8e] pt-1 pb-2 leading-[1.2] overflow-auto`} data-conversation-content>
        {messageListCopy.length > 0 && (
          <div className="mb-4 mt-2 text-base text-gray-500">Previous messages:</div>
        )}
        {messageListCopy.length > 0 && (
          <div className="mb-8">
            {messageListCopy.map((message) => (
              <div className="relative flex gap-4 mb-4" key={message.id}>
                <div className={`relative text-left text-sm gap-4 w-20 flex-shrink-0 mr-4 ${message.sender === 'user' ? 'text-[#0099ff]' : 'text-[#009900]'} font-medium`}>
                  <div>{getItemRole(message)}</div>
                </div>
                <div className="text-[#18181b] overflow-hidden break-words text-sm">
                  {message.message}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Most recent session conversation */}
        {items.length && <div className="mb-4 mt-2 text-base text-gray-500">Most Recent:</div>}
        {items.map((conversationItem) => (
          <div className="relative flex gap-4 mb-4 group" key={conversationItem.id}>
            <div
              className={`
                relative text-left gap-4 w-20 flex-shrink-0 mr-4 ${conversationItem.role === 'user' ? 'text-[#0099ff]' : conversationItem.role === 'assistant' ? 'text-[#009900]' : ''}
                `}
            >
              <div className='text-sm'>
                {getItemRole(conversationItem)}
              </div>
              {/* <div
                className="absolute top-0 -right-5 bg-gray-400 text-white rounded-full p-0.5 cursor-pointer hidden group-hover:flex hover:bg-gray-600"
                onClick={() => deleteConversationItem(conversationItem.id)}
              >
                <X className="stroke-current w-3 h-3" />
              </div> */}
            </div>
            <div className="text-[#18181b] overflow-hidden break-words text-sm">
              {/* Tool response */}
              {conversationItem.type === 'function_call_output' && (
                <div>{conversationItem.formatted.output}</div>
              )}
              {/* Tool call */}
              {conversationItem.formatted.tool && (
                <div>
                  {conversationItem.formatted.tool.name}(
                  {conversationItem.formatted.tool.arguments})
                </div>
              )}
              {!conversationItem.formatted.tool && conversationItem.role === 'user' && (
                <div className='text-sm'>
                  {conversationItem.formatted.transcript ||
                    (conversationItem.formatted.audio?.length
                      ? '(awaiting transcript)'
                      : conversationItem.formatted.text || '(item sent)')}
                </div>
              )}
              {!conversationItem.formatted.tool && conversationItem.role === 'assistant' && (
                <div className='text-sm'>{getItemText(conversationItem) || '(truncated)'}</div>
              )}
              {audioFiles[conversationItem.id] && conversationItem.role === 'assistant' && (
                <audio
                  src={audioFiles[conversationItem.id].url}
                  controls
                  className="pt-3"
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Mermaid Graph */}
      {/* TODO: visible in mobile but with a setting*/}
      {mermaidGraph && window.innerWidth > 768 && <ZoomableDiv>
        <pre id="mermaid-graph" className="mermaid mx-auto max-w-3xl">
          {mermaidGraph}
        </pre>
        {/* <div id="mermaid-graph" className="mermaid mx-auto max-w-3xl"/> */}
      </ZoomableDiv>}

      {/* Action Buttons */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t flex items-center justify-center gap-4 p-4">
        <Button
          label={isConnected ? 'disconnect' : 'connect'}
          iconPosition={isConnected ? 'end' : 'start'}
          icon={isConnected ? X : Zap}
          buttonStyle={isConnected ? 'regular' : 'action'}
          onClick={isConnected ? disconnectConversation : () => connectConversation(false)}
        />
        {window.innerWidth > 768 && <div className="flex-grow" />}
        {window.innerWidth > 768 && (
          <div>
            <div className="flex p-1 rounded-lg z-10 gap-0.5">
              <div className="relative flex items-center h-10 w-24 gap-1 text-[#0099ff]">
                <canvas ref={clientCanvasRef} className="w-full h-full text-current" />
              </div>
              <div className="relative flex items-center h-10 w-24 gap-1 text-[#009900]">
                <canvas ref={serverCanvasRef} className="w-full h-full text-current" />
              </div>
            </div>
          </div>
        )}
        <div className="flex-grow" />
        <div className="relative">
          <Button
            label="Options"
            iconPosition="start"
            icon={Settings}
            buttonStyle="action"
            className=""
            onClick={() => setShowSettings(!showSettings)}
          />
          {showSettings && (
            <div className="absolute bottom-full mb-2 right-0 flex flex-col bg-white shadow-lg rounded-lg p-2 min-w-[200px]">
              <Button
                label="Open in ChatGPT"
                iconPosition="start"
                icon={MessageCircle}
                buttonStyle="action"
                onClick={openInChatGPT}
              />
              <Button
                label="Regenerate Graph"
                iconPosition="start"
                icon={RefreshCw}
                buttonStyle="action"
                className="mt-2"
                onClick={() => {
                  setMermaidGraph('');
                  generateMermaidGraph();
                }}
              />
              <Button
                label="Copy Transcript"
                iconPosition="start"
                icon={Copy}
                buttonStyle="action"
                className="mt-2"
                onClick={copyConversation}
              />
            </div>
          )}
        </div>
        <div />
      </div>
    </div>
  );
}
