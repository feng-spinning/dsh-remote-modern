/** Local TCP forwarding through the dynamic SOCKS port of one OpenSSH process. */

import { once } from 'node:events'
import { createServer, Socket,             } from 'node:net'

                               
                
                      
 

/**
 * Expose one local loopback port through OpenSSH's dynamic forward. Unlike
 * `ssh -L`, the destination port is learned after the remote Host publishes
 * its endpoint, so reconnects do not depend on a fixed server-side port.
 */
export async function createSocksForward(localPort        , socksPort        , remotePort        )                        {
  const sockets = new Set        ()
  const track = (socket        )       => {
    sockets.add(socket)
    socket.once('close', () => { sockets.delete(socket) })
  }
  const server = createServer(client => {
    const socks = new Socket()
    track(client)
    track(socks)
    const fail = ()       => {
      client.destroy()
      socks.destroy()
    }
    // Modified for the modern adapter: a failed data channel must not produce
    // an unhandled socket error, and SOCKS negotiation has a bounded lifetime.
    client.on('error', fail)
    socks.on('error', fail)
    socks.setTimeout(15_000, fail)
    void (async () => {
      await connectSocket(socks, socksPort, '127.0.0.1')
      await writeSocket(socks, Buffer.from([0x05, 0x01, 0x00]))
      const greeting = await readExactly(socks, 2)
      if (greeting[0] !== 0x05 || greeting[1] !== 0x00) {
        throw new Error('dsh-remote-ssh: SSH SOCKS proxy rejected unauthenticated connection')
      }
      await writeSocket(socks, Buffer.from([
        0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1,
        (remotePort >> 8) & 0xff, remotePort & 0xff,
      ]))
      const reply = await readExactly(socks, 4)
      if (reply[0] !== 0x05 || reply[1] !== 0x00) {
        throw new Error(`dsh-remote-ssh: SSH SOCKS proxy could not reach remote Host (code ${String(reply[1])})`)
      }
      if (reply[3] === 0x01) await readExactly(socks, 4)
      else if (reply[3] === 0x04) await readExactly(socks, 16)
      else if (reply[3] === 0x03) {
        const length = (await readExactly(socks, 1))[0]
        if (length === undefined) throw new Error('dsh-remote-ssh: invalid SSH SOCKS address response')
        await readExactly(socks, length)
      } else {
        throw new Error('dsh-remote-ssh: invalid SSH SOCKS address type')
      }
      await readExactly(socks, 2)
      socks.setTimeout(0)
      client.pipe(socks)
      socks.pipe(client)
    })().catch(fail)
  })
  try {
    await new Promise      ((resolve, reject) => {
      const onError = (error       )       => { server.off('listening', onListening); reject(error) }
      const onListening = ()       => { server.off('error', onError); resolve() }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(localPort, '127.0.0.1')
    })
    return { server, sockets }
  } catch (error) {
    for (const socket of sockets) socket.destroy()
    throw error
  }
}

async function connectSocket(socket        , port        , host        )                {
  await new Promise      ((resolve, reject) => {
    const onError = (error       )       => { socket.off('connect', onConnect); reject(error) }
    const onConnect = ()       => { socket.off('error', onError); resolve() }
    socket.once('error', onError)
    socket.once('connect', onConnect)
    socket.connect(port, host)
  })
}

async function writeSocket(socket        , value        )                {
  if (socket.destroyed || !socket.writable) throw new Error('dsh-remote-ssh: SSH SOCKS socket closed')
  if (!socket.write(value)) await once(socket, 'drain')
}

async function readExactly(socket        , length        )                  {
  if (length === 0) return Buffer.alloc(0)
  const chunks           = []
  let received = 0
  for (;;) {
    const value = socket.read()                 
    if (value !== null) {
      const needed = length - received
      chunks.push(value.subarray(0, needed))
      received += Math.min(value.length, needed)
      if (value.length > needed) socket.unshift(value.subarray(needed))
      if (received === length) return Buffer.concat(chunks, length)
      continue
    }
    if (socket.destroyed || socket.readableEnded) throw new Error('dsh-remote-ssh: SSH SOCKS socket closed during handshake')
    await new Promise      ((resolve, reject) => {
      const cleanup = ()       => {
        socket.off('readable', onReadable)
        socket.off('error', onError)
        socket.off('end', onClosed)
        socket.off('close', onClosed)
      }
      const onReadable = ()       => { cleanup(); resolve() }
      const onError = (error       )       => { cleanup(); reject(error) }
      const onClosed = ()       => { cleanup(); reject(new Error('dsh-remote-ssh: SSH SOCKS socket closed during handshake')) }
      socket.once('readable', onReadable)
      socket.once('error', onError)
      socket.once('end', onClosed)
      socket.once('close', onClosed)
    })
  }
}
