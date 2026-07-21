/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { 
  doc, 
  onSnapshot, 
  updateDoc, 
  setDoc, 
  serverTimestamp,
  collection,
  query,
  where,
  getDocs
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Users, AlertCircle, RefreshCw, ChevronRight } from 'lucide-react';
import { auth, db, getPlayerId } from './lib/firebase';
import { GameRoom, Choice, RoundResult } from './types';

export default function App() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [lastRoundResult, setLastRoundResult] = useState<RoundResult | null>(null);
  const [isCpuThinking, setIsCpuThinking] = useState(false);
  const cpuThinkingRef = useRef(false);

  useEffect(() => {
    if (!room?.id || !room.isSinglePlayer || room.status !== 'playing' || showResult || cpuThinkingRef.current) return;

    const isCpuTurn = (room.kickerId === 'CPU' && room.kickerChoice === null) || 
                      (room.keeperId === 'CPU' && room.keeperChoice === null);

    if (isCpuTurn) {
      cpuThinkingRef.current = true;
      setIsCpuThinking(true);
      
      const timer = setTimeout(async () => {
        try {
          const choices: Choice[] = ['left', 'center', 'right'];
          const randomChoice = choices[Math.floor(Math.random() * choices.length)];
          const field = room.kickerId === 'CPU' ? 'kickerChoice' : 'keeperChoice';

          const roomRef = doc(db, 'rooms', room.id);
          await updateDoc(roomRef, {
            [field]: randomChoice,
            lastUpdated: serverTimestamp(),
          });
        } catch (err) {
          console.error("CPU choice failed", err);
        } finally {
          setIsCpuThinking(false);
          cpuThinkingRef.current = false;
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [room?.status, room?.kickerChoice, room?.keeperChoice, room?.kickerId, room?.keeperId, room?.isSinglePlayer, showResult]);

  useEffect(() => {
    const init = async () => {
      try {
        const id = await getPlayerId();
        setPlayerId(id);
      } catch (err) {
        console.error("Failed to initialize player ID", err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (!room?.id) return;

    const unsubscribe = onSnapshot(doc(db, 'rooms', room.id), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as GameRoom;
        setRoom({ ...data, id: snapshot.id });
      } else {
        setRoom(null);
      }
    });

    return () => unsubscribe();
  }, [room?.id]);

  // Separate effect to handle round resolution when both choices are present
  useEffect(() => {
    if (room && room.status === 'playing' && room.kickerChoice && room.keeperChoice && !showResult) {
      resolveRound(room);
    }
  }, [room?.kickerChoice, room?.keeperChoice, room?.status, showResult, playerId]);

  const resolveRound = async (currentRoom: GameRoom) => {
    if (showResult) return;
    
    // Both players see the same calculation
    const isGoal = currentRoom.kickerChoice !== currentRoom.keeperChoice;
    const isSaved = currentRoom.kickerChoice === currentRoom.keeperChoice;
    
    const result: RoundResult = {
      round: currentRoom.currentRound,
      kickerId: currentRoom.kickerId,
      keeperId: currentRoom.keeperId,
      kickerChoice: currentRoom.kickerChoice,
      keeperChoice: currentRoom.keeperChoice,
      isGoal,
      isSaved,
      isMissed: false,
    };

    setLastRoundResult(result);
    setShowResult(true);

    // Wait for players to see the result before moving to next round
    setTimeout(async () => {
      // Logic for moving to next round
      // In single player, human handles all transitions. In multiplayer, kicker handles it.
      const shouldHandleTransition = currentRoom.isSinglePlayer 
        ? (playerId && playerId !== 'CPU')
        : (playerId && playerId === currentRoom.kickerId);

      if (shouldHandleTransition) {
        try {
          const newScores = { ...currentRoom.scores };
          if (isGoal) {
            newScores[currentRoom.kickerId] = (newScores[currentRoom.kickerId] || 0) + 1;
          }

          const isGameOver = currentRoom.currentRound >= 10;
          const nextRound = currentRoom.currentRound + 1;
          
          // Swap roles
          const nextKicker = currentRoom.keeperId;
          const nextKeeper = currentRoom.kickerId;

          await updateDoc(doc(db, 'rooms', currentRoom.id), {
            currentRound: nextRound,
            kickerId: nextKicker,
            keeperId: nextKeeper,
            kickerChoice: null,
            keeperChoice: null,
            scores: newScores,
            status: isGameOver ? 'finished' : 'playing',
            history: [...(currentRoom.history || []), result],
            lastUpdated: serverTimestamp(),
          });
        } catch (err) {
          console.error("Transition failed", err);
        }
      }
      
      setShowResult(false);
    }, 3000);
  };

  const createRoom = async (isSingle = false) => {
    if (!playerName.trim()) {
      setError("Indtast venligst dit navn");
      return;
    }

    setLoading(true);
    try {
      const id = playerId || await getPlayerId();
      setPlayerId(id);
      const code = Math.floor(1000 + Math.random() * 9000).toString();
      const roomId = `room_${Date.now()}`;
      
      const newRoom: GameRoom = {
        id: roomId,
        code,
        players: isSingle ? [id, 'CPU'] : [id],
        playerNames: isSingle ? { [id]: playerName, 'CPU': 'Computer' } : { [id]: playerName },
        status: isSingle ? 'playing' : 'waiting',
        currentRound: 1,
        kickerId: id,
        keeperId: isSingle ? 'CPU' : '',
        kickerChoice: null,
        keeperChoice: null,
        scores: isSingle ? { [id]: 0, 'CPU': 0 } : { [id]: 0 },
        history: [],
        lastUpdated: serverTimestamp(),
        isSinglePlayer: isSingle,
      };

      await setDoc(doc(db, 'rooms', roomId), newRoom);
      setRoom(newRoom);
    } catch (err) {
      console.error(err);
      setError("Kunne ikke oprette rum. Prøv igen.");
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = async () => {
    if (!playerName.trim() || !roomCodeInput.trim()) {
      setError("Indtast venligst navn og kode");
      return;
    }

    setLoading(true);
    try {
      const id = playerId || await getPlayerId();
      setPlayerId(id);
      const roomsRef = collection(db, 'rooms');
      const q = query(roomsRef, where("code", "==", roomCodeInput), where("status", "==", "waiting"));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        setError("Rum ikke fundet eller er allerede fuldt.");
        setLoading(false);
        return;
      }

      const roomDoc = querySnapshot.docs[0];
      const roomData = roomDoc.data() as GameRoom;

      // Prevent joining your own room as second player twice
      if (roomData.players.includes(id)) {
        setRoom({ ...roomData, id: roomDoc.id });
        setLoading(false);
        return;
      }

      const updatedRoom = {
        ...roomData,
        players: [...roomData.players, id],
        playerNames: { ...roomData.playerNames, [id]: playerName },
        status: 'playing' as const,
        keeperId: id,
        scores: { ...roomData.scores, [id]: 0 },
        lastUpdated: serverTimestamp(),
      };

      await updateDoc(doc(db, 'rooms', roomDoc.id), updatedRoom);
      setRoom({ ...updatedRoom, id: roomDoc.id });
    } catch (err) {
      console.error(err);
      setError("Kunne ikke joine rum.");
    } finally {
      setLoading(false);
    }
  };

  const makeChoice = async (choice: Choice) => {
    if (!room || !playerId) return;

    const isKicker = playerId === room.kickerId;
    const field = isKicker ? 'kickerChoice' : 'keeperChoice';

    // Only update if not already chosen and result not showing
    if (room[field] || showResult) return;

    await updateDoc(doc(db, 'rooms', room.id), {
      [field]: choice,
      lastUpdated: serverTimestamp(),
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f172a] text-white font-sans">
        <div className="relative w-20 h-20 mb-8">
          <div className="absolute inset-0 bg-emerald-500 rounded-3xl animate-ping opacity-20" />
          <div className="absolute inset-0 bg-emerald-500 rounded-3xl flex items-center justify-center shadow-2xl shadow-emerald-500/50">
            <RefreshCw className="w-10 h-10 text-white animate-spin" />
          </div>
        </div>
        <p className="text-xl font-black italic uppercase tracking-tighter animate-pulse">Varmer op...</p>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-[#0f172a] p-6 flex flex-col items-center justify-center font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white rounded-[40px] shadow-2xl p-10 border-[6px] border-zinc-800 relative overflow-hidden"
        >
          <div className="text-center mb-10">
            <div className="bg-emerald-500 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-emerald-200/50 rotate-3">
              <Trophy className="text-white w-12 h-12" />
            </div>
            <h1 className="text-4xl font-black text-zinc-900 mb-2 tracking-tighter italic uppercase">Straffe-Duellen</h1>
            <p className="text-zinc-400 font-semibold text-sm tracking-wider uppercase">Vibrant Arena Edition</p>
          </div>

          <div className="space-y-6">
            <div className="relative">
              <label className="block text-[10px] font-black text-zinc-400 mb-2 ml-1 uppercase tracking-widest">Dit Navn</label>
              <input 
                type="text" 
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Indtast navn..."
                className="w-full px-5 py-4 rounded-2xl bg-zinc-100 border-b-4 border-zinc-200 focus:bg-white focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none text-zinc-900 font-bold placeholder:text-zinc-300"
              />
            </div>

            <div className="space-y-4 pt-4">
              <button 
                onClick={() => createRoom(false)}
                className="w-full py-5 bg-emerald-500 text-white rounded-2xl font-black text-lg shadow-xl shadow-emerald-200/50 hover:bg-emerald-600 border-b-4 border-emerald-700 active:border-b-0 active:translate-y-1 transition-all flex items-center justify-center gap-2 uppercase tracking-tight"
              >
                Spil mod ven
                <ChevronRight className="w-6 h-6" />
              </button>

              <button 
                onClick={() => createRoom(true)}
                className="w-full py-4 bg-white text-zinc-900 rounded-2xl font-black text-sm shadow-lg shadow-zinc-100 hover:bg-zinc-50 border-2 border-zinc-100 active:translate-y-1 transition-all flex items-center justify-center gap-2 uppercase tracking-tight"
              >
                Spil mod computer
                <RefreshCw className="w-4 h-4" />
              </button>

              <div className="relative flex items-center py-4">
                <div className="flex-grow border-t-2 border-zinc-100"></div>
                <span className="flex-shrink mx-4 text-zinc-400 text-[10px] font-black uppercase tracking-[0.2em]">Eller join</span>
                <div className="flex-grow border-t-2 border-zinc-100"></div>
              </div>

              <div className="flex gap-3">
                <input 
                  type="text" 
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value)}
                  placeholder="KODE"
                  maxLength={4}
                  className="flex-grow px-5 py-4 rounded-2xl bg-zinc-100 border-b-4 border-zinc-200 focus:bg-white focus:ring-4 focus:ring-zinc-200 focus:border-zinc-400 transition-all outline-none text-zinc-900 font-black tracking-[0.3em] text-center"
                />
                <button 
                  onClick={joinRoom}
                  className="px-8 py-4 bg-zinc-900 text-white rounded-2xl font-black hover:bg-zinc-800 border-b-4 border-zinc-950 active:border-b-0 active:translate-y-1 transition-all uppercase"
                >
                  Join
                </button>
              </div>
            </div>

            {error && (
              <motion.div 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="mt-6 p-4 bg-rose-50 border-2 border-rose-100 rounded-2xl flex items-center gap-4 text-rose-600 text-sm font-bold"
              >
                <AlertCircle className="w-6 h-6 flex-shrink-0" />
                <p>{error}</p>
              </motion.div>
            )}
          </div>
        </motion.div>

        <p className="mt-10 text-zinc-500 text-[11px] font-bold uppercase tracking-[0.3em] text-center">
          MULTIPLAYER • REAL-TIME • 1VS1
        </p>
      </div>
    );
  }

  if (room.status === 'waiting') {
    return (
      <div className="min-h-screen bg-[#0f172a] p-6 flex flex-col items-center justify-center font-sans">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-white rounded-[40px] shadow-2xl p-10 border-[6px] border-zinc-800 text-center"
        >
          <div className="bg-amber-100 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner">
            <Users className="text-amber-600 w-12 h-12" />
          </div>
          <h2 className="text-3xl font-black text-zinc-900 mb-2 italic uppercase tracking-tighter">Venter på holdet</h2>
          <p className="text-zinc-400 font-semibold text-sm mb-10 uppercase tracking-wider">Giv din ven denne kode:</p>
          
          <div className="bg-zinc-900 py-8 px-10 rounded-3xl border-4 border-emerald-500 shadow-2xl mb-10 transform -rotate-1">
            <span className="text-6xl font-black text-white tracking-[0.4em] ml-[0.4em] drop-shadow-lg">{room.code}</span>
          </div>

          <div className="flex items-center justify-center gap-4 text-emerald-600">
            <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
            <p className="text-sm font-black uppercase tracking-widest">Klar til kick-off...</p>
          </div>
        </motion.div>
      </div>
    );
  }

  const isKicker = playerId === room.kickerId;
  const myChoice = isKicker ? room.kickerChoice : room.keeperChoice;
  const opponentName = room.playerNames[isKicker ? room.keeperId : room.kickerId];

  return (
    <div className="min-h-screen bg-[#0f172a] text-zinc-900 flex flex-col overflow-hidden relative font-sans">
      {/* Pitch Gradient Layer */}
      <div className="absolute inset-0 pitch-gradient opacity-100" />
      <div className="absolute inset-0 grass-pattern opacity-100" />

      {/* Header / Scoreboard */}
      <div className="relative pt-12 px-6 flex flex-col items-center z-10">
        <div className="bg-black/40 backdrop-blur-md rounded-full px-6 py-2 mb-6 border border-white/10 shadow-lg">
          <span className="text-emerald-400 text-[10px] font-black tracking-[0.3em] uppercase">RUM: {room.code}</span>
        </div>
        
        <div className="w-full max-w-md flex justify-between items-center bg-white rounded-[32px] p-6 shadow-2xl border-b-8 border-zinc-200">
          <div className="flex flex-col items-center w-1/3">
            <div className="w-14 h-14 bg-emerald-500 rounded-2xl flex items-center justify-center text-2xl font-black text-white shadow-xl shadow-emerald-200/50 border-b-4 border-emerald-700">
              {room.playerNames[room.players[0]]?.substring(0, 2).toUpperCase() || 'P1'}
            </div>
            <span className="text-[10px] font-black mt-2 text-zinc-400 uppercase tracking-widest truncate max-w-full">
              {room.playerNames[room.players[0]]}
            </span>
          </div>

          <div className="flex flex-col items-center">
            <div className="text-5xl font-black text-zinc-900 tracking-tighter italic">
              {room.scores[room.players[0]] || 0} — {room.scores[room.players[1]] || 0}
            </div>
            <div className="text-[10px] font-black text-rose-500 bg-rose-50 px-4 py-1 rounded-full uppercase tracking-widest mt-2 border border-rose-100">
              Runde {Math.ceil(room.currentRound / 2)}/5
            </div>
          </div>

          <div className="flex flex-col items-center w-1/3">
            <div className="w-14 h-14 bg-amber-400 rounded-2xl flex items-center justify-center text-2xl font-black text-white shadow-xl shadow-amber-200/50 border-b-4 border-amber-600">
              {room.playerNames[room.players[1]]?.substring(0, 2).toUpperCase() || 'P2'}
            </div>
            <span className="text-[10px] font-black mt-2 text-zinc-400 uppercase tracking-widest truncate max-w-full">
              {room.playerNames[room.players[1]]}
            </span>
          </div>
        </div>
      </div>

      {/* Game Field */}
      <div className="flex-1 relative mt-4 z-0">
        {/* Goal */}
        <div className="absolute top-12 left-1/2 -translate-x-1/2 w-[300px] h-40 border-[8px] border-b-0 border-white rounded-t-3xl z-10 shadow-inner overflow-hidden bg-white/5 backdrop-blur-[2px]">
          <div className="w-full h-full goal-net opacity-60"></div>
          
          {/* Result Indicators in the net */}
          <AnimatePresence>
            {showResult && lastRoundResult && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.5, y: 50 }}
                animate={{ opacity: 1, scale: 1.2, y: 0 }}
                exit={{ opacity: 0, scale: 2 }}
                className="absolute inset-0 flex items-center justify-center z-50"
              >
                <div className={`text-5xl font-black italic tracking-tighter uppercase ${lastRoundResult.isGoal ? 'text-emerald-400 drop-shadow-[0_0_20px_rgba(52,211,153,0.8)]' : 'text-rose-500 drop-shadow-[0_0_20px_rgba(244,63,94,0.8)]'}`}>
                  {lastRoundResult.isGoal ? 'MÅÅÅL!' : 'REDNING!'}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        {/* Keeper visualization */}
        <div className="absolute top-36 left-1/2 -translate-x-1/2 w-20 h-20 z-20">
           <motion.div
             animate={showResult && lastRoundResult ? {
               x: lastRoundResult.keeperChoice === 'left' ? -90 : lastRoundResult.keeperChoice === 'right' ? 90 : 0,
               y: lastRoundResult.keeperChoice === 'center' ? 0 : 30,
               rotate: lastRoundResult.keeperChoice === 'left' ? -60 : lastRoundResult.keeperChoice === 'right' ? 60 : 0,
               scale: 1.1
             } : { x: 0, y: 0, rotate: 0, scale: 1 }}
             transition={{ type: 'spring', stiffness: 200, damping: 20 }}
             className="w-full h-full bg-zinc-800 rounded-full border-[6px] border-amber-300 shadow-2xl flex items-center justify-center relative"
           >
             <div className="w-10 h-10 bg-white/10 rounded-full animate-pulse" />
             <div className="absolute -top-1 w-6 h-1 bg-white/20 rounded-full" />
           </motion.div>
        </div>

        {/* The Ball */}
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 w-20 h-20 z-30">
          <motion.div
            animate={showResult && lastRoundResult ? {
              x: lastRoundResult.kickerChoice === 'left' ? -100 : lastRoundResult.kickerChoice === 'right' ? 100 : 0,
              y: -220,
              scale: 0.35,
              rotate: 720,
              filter: 'blur(1px)'
            } : { x: 0, y: 0, scale: 1, rotate: 0, filter: 'blur(0px)' }}
            transition={{ 
              duration: 0.5, 
              ease: [0.23, 1, 0.32, 1],
              scale: { duration: 0.4 }
            }}
            className="w-full h-full bg-white rounded-full shadow-[0_20px_40px_rgba(0,0,0,0.5)] flex items-center justify-center overflow-hidden border-2 border-zinc-100"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,#fff,#ccc)]"></div>
            <div className="grid grid-cols-2 gap-2 rotate-45 opacity-20">
               <div className="w-8 h-8 bg-black rounded-full"></div>
               <div className="w-8 h-8 bg-black rounded-full"></div>
               <div className="w-8 h-8 bg-black rounded-full"></div>
               <div className="w-8 h-8 bg-black rounded-full"></div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Controls Container */}
      <div className="bg-white rounded-t-[48px] p-10 pb-12 shadow-[0_-20px_60px_rgba(0,0,0,0.2)] z-10 relative">
        <div className="flex flex-col items-center">
          <div className="flex items-center space-x-3 mb-8">
             <div className="w-3 h-3 rounded-full bg-rose-500 animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.5)]"></div>
             <span className="text-sm font-black text-zinc-900 tracking-widest uppercase">
               {isKicker ? 'DIN TUR: SKYD MOD MÅL!' : 'DIN TUR: RED BOLTEN!'}
             </span>
          </div>
          
          <div className="grid grid-cols-3 gap-6 w-full max-w-md">
            {(['left', 'center', 'right'] as Choice[]).map((choice) => {
              const isActive = myChoice === choice;
              const isOtherActive = myChoice && myChoice !== choice;
              const isCenter = choice === 'center';
              
              return (
                <button
                  key={choice || 'none'}
                  disabled={!!myChoice || showResult}
                  onClick={() => makeChoice(choice)}
                  className={`
                    aspect-square rounded-[32px] flex flex-col items-center justify-center transition-all duration-300
                    ${isActive 
                      ? 'bg-emerald-500 border-b-8 border-emerald-700 shadow-2xl shadow-emerald-200 -translate-y-2' 
                      : 'bg-zinc-100 border-b-8 border-zinc-200 active:border-b-0 active:translate-y-1 hover:bg-zinc-200'}
                    ${isOtherActive ? 'opacity-30 scale-90' : ''}
                    ${showResult ? 'pointer-events-none' : ''}
                  `}
                >
                  <div className={`text-4xl mb-2 filter drop-shadow-sm ${isActive ? 'scale-110' : ''}`}>
                    {choice === 'left' ? '↖️' : choice === 'center' ? '⬆️' : '↗️'}
                  </div>
                  <span className={`text-[10px] font-black uppercase tracking-widest ${isActive ? 'text-white' : 'text-zinc-500'}`}>
                    {choice === 'left' ? 'Venstre' : choice === 'center' ? 'Midt' : 'Højre'}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-10 w-32 h-2 bg-zinc-100 rounded-full overflow-hidden">
             <motion.div 
               animate={{ x: myChoice ? 0 : -100 }}
               className="w-full h-full bg-emerald-500" 
             />
          </div>
          
          <p className="mt-4 text-zinc-300 text-[10px] font-black uppercase tracking-[0.2em]">
            {isCpuThinking ? 'COMPUTEREN TÆNKER...' : myChoice ? `Venter på ${opponentName?.toUpperCase() || 'MODSTANDER'}` : 'Vælg din retning nu'}
          </p>
        </div>
      </div>

      {/* Footer Game Over */}
      {room.status === 'finished' && (
        <div className="absolute inset-0 z-[100] bg-zinc-950/95 backdrop-blur-2xl flex flex-col items-center justify-center p-8 font-sans text-white">
          <motion.div 
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center w-full max-w-sm"
          >
            <div className="bg-amber-400 w-32 h-32 rounded-full flex items-center justify-center mx-auto mb-10 shadow-[0_0_50px_rgba(251,191,36,0.4)] animate-bounce">
              <Trophy className="w-16 h-16 text-white" />
            </div>
            <h2 className="text-6xl font-black mb-2 italic tracking-tighter uppercase">Færdig!</h2>
            <p className="text-emerald-400 font-black text-sm mb-12 uppercase tracking-[0.3em]">Kampen er slut</p>

            <div className="bg-white rounded-[40px] p-10 shadow-2xl border-b-8 border-zinc-200 text-zinc-900 mb-12">
              <div className="grid grid-cols-2 gap-8">
                <div className="text-center">
                  <p className="text-[10px] font-black text-zinc-400 mb-2 uppercase tracking-widest truncate">{room.playerNames[room.players[0]]}</p>
                  <p className="text-6xl font-black tracking-tighter italic">{room.scores[room.players[0]] || 0}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-black text-zinc-400 mb-2 uppercase tracking-widest truncate">{room.playerNames[room.players[1]]}</p>
                  <p className="text-6xl font-black tracking-tighter italic">{room.scores[room.players[1]] || 0}</p>
                </div>
              </div>
              <div className="mt-10 pt-8 border-t-4 border-zinc-50">
                <h4 className="text-2xl font-black italic uppercase tracking-tighter text-emerald-600">
                  {room.scores[room.players[0]] === room.scores[room.players[1]] 
                    ? 'UAFGJORT!' 
                    : `${room.scores[room.players[0]]! > room.scores[room.players[1]]! 
                        ? room.playerNames[room.players[0]] 
                        : room.playerNames[room.players[1]]} VINDER!`}
                </h4>
              </div>
            </div>

            <button 
              onClick={() => window.location.reload()}
              className="w-full py-6 bg-emerald-500 text-white rounded-3xl font-black text-xl flex items-center justify-center gap-4 shadow-2xl shadow-emerald-500/40 border-b-8 border-emerald-700 active:border-b-0 active:translate-y-2 transition-all uppercase italic"
            >
              <RefreshCw className="w-6 h-6" />
              Nyt Spil
            </button>
          </motion.div>
        </div>
      )}
    </div>
  );
}
