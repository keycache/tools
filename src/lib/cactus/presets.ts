import type { ToolSchema } from './engine'

export interface ToolPreset {
  id: string
  label: string
  tools: ToolSchema[]
  examples: string[]
}

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSchema['parameters'] => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
})

export const TOOL_PRESETS: ToolPreset[] = [
  {
    id: 'smart-home',
    label: 'Smart home',
    tools: [
      {
        name: 'set_lights',
        description: "Turn a room's lights on or off, or dim them to a brightness",
        parameters: obj(
          {
            room: { type: 'string', description: 'Room name, e.g. kitchen' },
            on: { type: 'boolean', description: 'true to switch on or dim, false only to switch off' },
            brightness: { type: 'integer', description: 'Percent, 0-100' },
          },
          ['room', 'on'],
        ),
      },
      {
        name: 'set_thermostat',
        description: 'Set the heating or cooling target temperature',
        parameters: obj({ temperature: { type: 'number', description: 'Degrees' }, unit: { type: 'string', enum: ['C', 'F'], default: 'C' } }, ['temperature']),
      },
      {
        name: 'lock_door',
        description: 'Lock or unlock a door',
        parameters: obj({ door: { type: 'string', description: 'e.g. front door, garage' }, locked: { type: 'boolean' } }, ['door', 'locked']),
      },
      {
        name: 'set_timer',
        description: 'Start a countdown timer',
        parameters: obj({ minutes: { type: 'integer' }, label: { type: 'string' } }, ['minutes']),
      },
    ],
    examples: [
      'Dim the bedroom to 20% and lock the front door',
      'Set the heating to 21 degrees',
      'Turn off the kitchen lights and set a 10 minute pasta timer',
      'What is the capital of France?',
    ],
  },
  {
    id: 'phone',
    label: 'Phone assistant',
    tools: [
      {
        name: 'send_message',
        description: 'Send a text message to a contact',
        parameters: obj({ contact: { type: 'string' }, message: { type: 'string' } }, ['contact', 'message']),
      },
      {
        name: 'create_event',
        description: 'Add an event to the calendar',
        parameters: obj(
          { title: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'HH:MM, 24h' } },
          ['title', 'date'],
        ),
      },
      {
        name: 'set_alarm',
        description: 'Set an alarm for a time of day',
        parameters: obj({ time: { type: 'string', description: 'HH:MM, 24h' } }, ['time']),
      },
      {
        name: 'open_app',
        description: 'Open an app on the phone',
        parameters: obj({ app: { type: 'string' } }, ['app']),
      },
    ],
    examples: [
      'Text Sam that I will be 10 minutes late',
      'Put dentist on my calendar tomorrow at 3pm',
      'Wake me up at 6:45 and open Spotify',
    ],
  },
]

export interface ExtractPreset {
  id: string
  label: string
  schema: ToolSchema
  sample: string
}

export const EXTRACT_PRESETS: ExtractPreset[] = [
  {
    id: 'receipt',
    label: 'Card charge',
    schema: {
      name: 'card_charge',
      description: 'A card payment notification',
      parameters: obj(
        { merchant: { type: 'string' }, amount: { type: 'number' }, currency: { type: 'string', description: 'ISO code, e.g. USD' }, date: { type: 'string', description: 'YYYY-MM-DD' } },
        ['merchant', 'amount'],
      ),
    },
    sample: 'Your Visa ending 4421 was charged $23.80 at Blue Bottle Coffee on Nov 3, 2026.',
  },
  {
    id: 'booking',
    label: 'Booking',
    schema: {
      // Phrased as "record" so Needle treats it as data capture; "booking" made it refuse ("no tool can book a table").
      name: 'record_reservation',
      description: 'Record the details of a restaurant reservation request',
      parameters: obj(
        { name: { type: 'string' }, party_size: { type: 'integer' }, date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'HH:MM, 24h' }, venue: { type: 'string' } },
        ['name', 'date'],
      ),
    },
    sample: 'Hi, this is Priya. Could I get a table for 4 at Osteria Rome on December 12th 2026 around 7:30pm?',
  },
  {
    id: 'contact',
    label: 'Contact',
    schema: {
      name: 'contact',
      description: 'Contact details from an email signature',
      parameters: obj({ name: { type: 'string' }, title: { type: 'string' }, company: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' } }, ['name']),
    },
    sample: 'Best,\nDana Whitfield\nHead of Operations, Northwind Logistics\ndana.w@northwind.io | +1 (415) 555-0142',
  },
]

/** Questions for the bundled stop-sign sample (src/assets/samples/stop-sign.jpg), used by the "Scene" preset. */
export const SCENE_FORM: Record<string, unknown> = {
  setting: { enum: ['indoor', 'outdoor'] },
  sign_type: { enum: ['stop', 'yield', 'speed limit'] },
  sign_color: { enum: ['red', 'yellow', 'blue', 'green'] },
  people: { type: 'integer', minimum: 0, maximum: 10 },
  time_of_day: { enum: ['day', 'night'] },
}

/** Shown as the placeholder of the empty "Custom" question editor. */
export const CUSTOM_FORM_EXAMPLE = `{
  "main_color": { "enum": ["red", "green", "blue", "other"] },
  "count": { "type": "integer", "minimum": 0, "maximum": 10 }
}`

export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'German' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
]

export function parseJson<T>(text: string): { value?: T; error?: string } {
  try {
    return { value: JSON.parse(text) as T }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Invalid JSON' }
  }
}
