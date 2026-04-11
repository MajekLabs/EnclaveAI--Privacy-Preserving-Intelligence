'use client'

import { useState, useEffect } from 'react'
import { Shield, Lock, Network, Zap, FileText, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useStellarWallet } from '@/hooks/use-stellar-wallet'
import { useTEEConnection } from '@/hooks/use-tee-connection'

export default function HomePage() {
  const [isConnected, setIsConnected] = useState(false)
  const { connectWallet, disconnectWallet, publicKey, isConnected: walletConnected } = useStellarWallet()
  const { connectTEE, isTEEConnected, processingStatus } = useTEEConnection()

  useEffect(() => {
    setIsConnected(walletConnected && isTEEConnected)
  }, [walletConnected, isTEEConnected])

  const handleConnect = async () => {
    if (!walletConnected) {
      await connectWallet()
    }
    if (!isTEEConnected) {
      await connectTEE()
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      {/* Header */}
      <header className="border-b bg-white/50 backdrop-blur-sm dark:bg-slate-900/50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Shield className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">EnclaveAI</h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-sm text-slate-600 dark:text-slate-400">
                {publicKey ? `Connected: ${publicKey.slice(0, 8)}...` : 'Not Connected'}
              </div>
              <Button
                onClick={isConnected ? disconnectWallet : handleConnect}
                variant={isConnected ? "outline" : "default"}
              >
                {isConnected ? 'Disconnect' : 'Connect Wallet'}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center space-y-6">
          <h2 className="text-4xl font-bold text-slate-900 dark:text-white">
            Privacy-Preserving Intelligence
          </h2>
          <p className="text-xl text-slate-600 dark:text-slate-400 max-w-3xl mx-auto">
            Process your sensitive data with AI in secure hardware enclaves. 
            Zero-knowledge processing ensures your data never leaves the protected environment.
          </p>
          <div className="flex items-center justify-center space-x-4">
            <div className="flex items-center space-x-2">
              <Lock className="h-5 w-5 text-green-600" />
              <span className="text-sm font-medium">End-to-End Encrypted</span>
            </div>
            <div className="flex items-center space-x-2">
              <Network className="h-5 w-5 text-blue-600" />
              <span className="text-sm font-medium">Decentralized Network</span>
            </div>
            <div className="flex items-center space-x-2">
              <Zap className="h-5 w-5 text-purple-600" />
              <span className="text-sm font-medium">TEE Protected</span>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section className="container mx-auto px-4 py-8">
        <Tabs defaultValue="process" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="process">Process Data</TabsTrigger>
            <TabsTrigger value="history">Processing History</TabsTrigger>
            <TabsTrigger value="network">Network Status</TabsTrigger>
          </TabsList>

          <TabsContent value="process" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <FileText className="h-5 w-5" />
                  <span>Secure AI Processing</span>
                </CardTitle>
                <CardDescription>
                  Upload your documents for AI analysis in a trusted execution environment
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
                  <FileText className="h-12 w-12 mx-auto text-slate-400 mb-4" />
                  <p className="text-slate-600 dark:text-slate-400 mb-4">
                    Drag and drop your files here or click to browse
                  </p>
                  <Button disabled={!isConnected}>
                    {isConnected ? 'Select Files' : 'Connect Wallet First'}
                  </Button>
                </div>
                {processingStatus && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Processing Status</span>
                      <span className="text-sm text-slate-600">{processingStatus.status}</span>
                    </div>
                    <Progress value={processingStatus.progress} className="w-full" />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Processing History</CardTitle>
                <CardDescription>
                  View your past AI processing requests and results
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-slate-500">
                  <Activity className="h-12 w-12 mx-auto mb-4" />
                  <p>No processing history available</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="network" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Active Nodes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-blue-600">12</div>
                  <p className="text-sm text-slate-600">TEE-enabled nodes</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Total Processed</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-green-600">1,247</div>
                  <p className="text-sm text-slate-600">Requests completed</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Network Health</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-purple-600">98.5%</div>
                  <p className="text-sm text-slate-600">Uptime this month</p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </section>
    </div>
  )
}
