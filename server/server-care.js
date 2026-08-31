import 'dotenv/config';
import express from 'express';
import http from 'http';
import crypto from 'crypto';
import { Server } from 'socket.io';
const app=express();const server=http.createServer(app);const port=Number(process.env.PORT)||3000;const origin=process.env.FRONTEND_URL||'*';
app.get('/',(_q,r)=>r.json({service:'Shop Camzon Voice Call Signaling',status:'online'}));app.get('/health',(_q,r)=>r.json({status:'ok',timestamp:new Date().toISOString()}));
const io=new Server(server,{cors:{origin:origin==='*'?'*':origin.split(',').map(x=>x.trim()),methods:['GET','POST']},transports:['websocket','polling']});
const users=new Map();const calls=new Map();const rooms=new Map();
const reply=(cb,p)=>typeof cb==='function'&&cb(p);const code=()=>String(crypto.randomInt(100000,1000000));
function peer(call,id){return call.callerSocket===id?call.adminSocket:call.callerSocket}
function endCall(id,reason='Call ended.'){const c=calls.get(id);if(!c)return;for(const s of [c.callerSocket,c.adminSocket])if(s)io.to(s).emit('call-ended',{callId:id,reason});calls.delete(id)}
io.on('connection',socket=>{
 socket.emit('server-ready',{socketId:socket.id});
 socket.on('register',data=>{const d=data||{};users.set(socket.id,{socketId:socket.id,userId:String(d.userId||''),role:d.role==='admin'?'admin':'customer',name:String(d.name||'Customer')});socket.data.user=users.get(socket.id);socket.emit('registered',{socketId:socket.id});});
 socket.on('call-customer-care',data=>{const u=socket.data.user;if(!u||u.role!=='customer')return;const admin=[...users.values()].find(x=>x.role==='admin'&&io.sockets.sockets.has(x.socketId));if(!admin)return socket.emit('call-unavailable',{message:'Customer Care is offline.'});const id=crypto.randomUUID();const c={id,callerSocket:socket.id,adminSocket:admin.socketId,callerId:u.userId,callerName:u.name,createdAt:Date.now()};calls.set(id,c);io.to(admin.socketId).emit('incoming-care-call',{callId:id,callerId:u.userId,callerName:u.name});socket.emit('call-ringing',{callId:id,adminName:admin.name});});
 socket.on('accept-care-call',data=>{const c=calls.get(data?.callId);if(!c||c.adminSocket!==socket.id)return;c.accepted=true;io.to(c.callerSocket).emit('call-accepted',{callId:c.id,adminName:socket.data.user?.name||'Customer Care'});});
 socket.on('reject-care-call',data=>{const c=calls.get(data?.callId);if(!c||c.adminSocket!==socket.id)return;io.to(c.callerSocket).emit('call-rejected',{callId:c.id});calls.delete(c.id)});
 for(const event of ['offer','answer','ice-candidate'])socket.on(event,data=>{const c=calls.get(data?.callId);if(!c)return;const other=peer(c,socket.id);if(other)io.to(other).emit(event,{...data,callId:c.id});});
 socket.on('end-care-call',data=>{const c=calls.get(data?.callId);if(c&&(c.callerSocket===socket.id||c.adminSocket===socket.id))endCall(c.id);});
 socket.on('create-room',(...a)=>{const cb=typeof a.at(-1)==='function'?a.pop():null;let c=code();rooms.set(c,{host:socket.id,guest:null,createdAt:Date.now()});socket.join(`call:${c}`);reply(cb,{success:true,code:c,expiresIn:1800000});});
 socket.on('join-room',(...a)=>{const cb=typeof a.at(-1)==='function'?a.pop():null;const d=a[0]||{},r=rooms.get(d.code);if(!r||r.guest)return reply(cb,{success:false,message:'Call unavailable.'});r.guest=socket.id;socket.join(`call:${d.code}`);reply(cb,{success:true,code:d.code,role:'guest'});io.to(r.host).emit('peer-joined',{code:d.code});});
 socket.on('room-status',(...a)=>{const cb=typeof a.at(-1)==='function'?a.pop():null;const r=rooms.get(a[0]?.code);reply(cb,r?{success:true,connected:!!r.guest}:{success:false,message:'Call expired.'})});
 socket.on('disconnect',()=>{users.delete(socket.id);for(const [id,c] of calls)if(c.callerSocket===socket.id||c.adminSocket===socket.id)endCall(id,'The other person disconnected.');for(const [id,r] of rooms)if(r.host===socket.id||r.guest===socket.id)rooms.delete(id)});
});
server.listen(port,'0.0.0.0',()=>console.log(`Shop Camzon call server listening on ${port}`));