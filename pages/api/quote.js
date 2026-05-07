import OpenAI from 'openai'

const SYSTEM_PROMPT = `You are an expert electrician estimating jobs from photos. Analyze the provided image and generate a detailed, professional quote for an electrical job.

Given:
- Labor rate: $${process.env.LABOR_RATE || 95}/hour
- Trip charge: $${process.env.TRIP_CHARGE || 75}
- Service type: {serviceType}
- Additional notes: {notes}

Output a JSON object ONLY (no markdown, no text outside the JSON) with this exact shape:
{
  "summary": "2-3 sentence description of what you see and the work needed",
  "lineItems": [
    {
      "description": "Clear name of the line item",
      "qty": 1,
      "laborHrs": 0.5,
      "materials": "List of materials needed",
      "unitCost": 0,
      "total": 125.00
    }
  ],
  "totalHours": 2.5,
  "materialsTotal": 180.00,
  "total": 592.50,
  "warranties": "2-year workmanship warranty on labor. Materials per manufacturer."
}

Rules:
- Be specific about what you observe (panel type, wire gauge visible, number of circuits, condition, etc.)
- Line items should reflect typical electrical work scopes
- Labor hours should be realistic for the observed work
- Materials should list actual electrical components (breakers, wire, conduit, boxes, etc.)
- Total = trip charge + (totalHours × laborRate) + materialsTotal
- Only output valid JSON. No preamble or explanation.`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { imageData, serviceType, customerName, customerAddress, notes } = req.body

  if (!imageData || !serviceType) {
    return res.status(400).json({ error: 'Image and service type are required' })
  }

  if (!process.env.OPENAI_API_SECRET) {
    return res.status(500).json({
      error: 'OpenAI API key not configured. Add OPENAI_API_SECRET to your Vercel environment variables.',
    })
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_SECRET })

  const promptText = SYSTEM_PROMPT
    .replace('{serviceType}', serviceType)
    .replace('{notes}', notes || 'None provided')

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: promptText,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageData,
                detail: 'high',
              },
            },
          ],
        },
      ],
      max_tokens: 2048,
      temperature: 0.3,
    })

    const raw = completion.choices[0]?.message?.content?.trim()
    if (!raw) {
      throw new Error('Empty response from OpenAI')
    }

    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '')
    const quote = JSON.parse(jsonStr)

    // Validate structure
    if (typeof quote.total !== 'number' || !Array.isArray(quote.lineItems)) {
      throw new Error('Invalid quote structure from AI')
    }

    res.status(200).json(quote)
  } catch (err) {
    console.error('Quote generation error:', err)
    res.status(500).json({
      error: 'Failed to generate quote. Check your image and try again.',
      detail: err.message,
    })
  }
}
