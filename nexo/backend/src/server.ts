import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { routerProvaAssinatura } from './prova/assinatura.js'

const app = express()
const port = Number(process.env.PORT ?? 3001)

app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173' }))
app.use(express.json())

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', project: 'Nexo' })
})

// Prova técnica isolada da Etapa 1 (hipótese H-23). Não é a API do Nexo.
app.use('/api/prova-assinatura', routerProvaAssinatura())

app.listen(port, () => {
  console.log(`Nexo API disponível em http://localhost:${port}`)
})
