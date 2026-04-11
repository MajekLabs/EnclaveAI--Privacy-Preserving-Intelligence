import { useState, useEffect } from 'react'
import * as StellarSdk from '@stellar/stellar-sdk'

export function useStellarWallet() {
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const connectWallet = async () => {
    setIsLoading(true)
    try {
      // Check if Freighter is available
      if (!window.freighter) {
        throw new Error('Freighter wallet not found. Please install Freighter.')
      }

      // Get public key from Freighter
      const publicKey = await window.freighter.getPublicKey()
      setPublicKey(publicKey)
      setIsConnected(true)
    } catch (error) {
      console.error('Failed to connect wallet:', error)
      throw error
    } finally {
      setIsLoading(false)
    }
  }

  const disconnectWallet = () => {
    setPublicKey(null)
    setIsConnected(false)
  }

  const signTransaction = async (xdr: string) => {
    if (!isConnected || !window.freighter) {
      throw new Error('Wallet not connected')
    }

    try {
      const signedXdr = await window.freighter.signTransaction(xdr)
      return signedXdr
    } catch (error) {
      console.error('Failed to sign transaction:', error)
      throw error
    }
  }

  return {
    publicKey,
    isConnected,
    isLoading,
    connectWallet,
    disconnectWallet,
    signTransaction,
  }
}

// Type declaration for Freighter
declare global {
  interface Window {
    freighter?: {
      isConnected: () => Promise<boolean>
      getPublicKey: () => Promise<string>
      signTransaction: (xdr: string) => Promise<string>
    }
  }
}
