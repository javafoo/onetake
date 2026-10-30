import type { ShotType } from "../style/house-style";

/* Ready-made scene ideas, so making a new photo never starts from a blank box.
   Each one is a rough idea of the kind a user would type: where she is and what
   she is doing. Her face, makeup, wardrobe and the photo style are added by the
   prompt writer, so none of that belongs here. Safe to send to the browser.

   Every scene is lit by daylight, because the house style only writes daylight. */

export type Scene = {
  label: string;
  idea: string;
  shot: ShotType;
  /** The idea already says what her face is doing, so a random expression would fight it. */
  ownExpression?: boolean;
};

export type SceneGroup = { name: string; scenes: Scene[] };

export const SCENE_GROUPS: SceneGroup[] = [
  {
    name: "Everyday",
    scenes: [
      { label: "Car after the gym", idea: "In the driver's seat of her parked car after the gym, seatbelt on, holding an iced latte", shot: "selfie" },
      { label: "Sunroof car selfie", idea: "In the driver's seat of a parked car, seatbelt on, one hand resting on top of her head, sunroof light dappling her hair", shot: "selfie" },
      { label: "Passenger seat, dusk", idea: "In the passenger seat at dusk, head resting back against the seat, the last blue daylight outside and streetlights just starting to glow", shot: "selfie" },
      { label: "Sunday in bed", idea: "Lying back on white pillows in bed in the morning, holding the phone above her, hair spread across the pillow", shot: "selfie" },
      { label: "Slow morning mug", idea: "Leaning against the kitchen counter in the morning, holding a steaming white mug with both hands", shot: "friend" },
      { label: "Couch, reading a DM", idea: "Curled up on a cream sofa holding her phone with both hands, reacting to something on the screen with raised eyebrows and a surprised smile, the screen facing away from the camera", shot: "friend", ownExpression: true },
      { label: "Living room mirror", idea: "Standing in a bright living room, phone held at chest height with both hands so it partly covers her chin, one side of her hair tucked behind her ear", shot: "mirror" },
      { label: "Close-up, white wall", idea: "Chest up against a plain warm white wall, window light on one cheekbone and shoulder", shot: "selfie" },
      { label: "Sunny stucco wall", idea: "Standing against a white stucco wall in direct sun, her hard shadow beside her, sunglasses pushed up on her head", shot: "friend" },
      { label: "0.5x at brunch", idea: "At an outdoor cafe table, arm stretched out with the phone, iced drinks and plates on the table curving away behind her", shot: "wide_selfie" },
    ],
  },
  {
    name: "Cafe and work",
    scenes: [
      { label: "Cafe laptop", idea: "At a white marble cafe table by a big window with an open laptop, a croissant and an iced latte, glancing up from the screen", shot: "friend" },
      { label: "Planning the week", idea: "At a cafe table writing in an open cream notebook, seen from slightly above and behind her shoulder as she glances up mid-thought, iced coffee and her phone face down beside her, the page blank", shot: "friend" },
      { label: "Cafe window profile", idea: "In side profile working on a laptop at a tall counter by a floor-to-ceiling cafe window, the bright street behind the glass, a cappuccino beside her", shot: "friend" },
      { label: "The explainer", idea: "At a light wood desk in a bright home office with an open laptop, turned to the camera and pointing at the empty space beside her as if explaining a chart", shot: "friend", ownExpression: true },
      { label: "Kitchen counter chat", idea: "Seated at a white kitchen counter with her elbows on the marble, looking into the camera as if about to talk, a bowl of lemons behind her", shot: "selfie" },
      { label: "Armchair interview", idea: "Seated in a cream boucle armchair in a bright minimal room, leaning slightly forward with her hands loosely clasped, speaking to the camera", shot: "friend" },
      { label: "Talking still", idea: "Chest up against a plain warm white wall, hands out of frame, hair even over both shoulders, looking straight into the lens, a clean still made to be animated into a talking clip", shot: "selfie" },
    ],
  },
  {
    name: "Talking to camera",
    scenes: [
      { label: "Podcast, big mic", idea: "At a light oak desk in a warm home office set up for recording, speaking into a large black broadcast microphone on a boom arm, headphones resting around her neck", shot: "friend" },
      { label: "Podcast, the laugh", idea: "At a podcast desk laughing mid-sentence with her head tilted slightly back and one hand near her collarbone, a broadcast microphone at the edge of the frame", shot: "friend", ownExpression: true },
      { label: "Tiny mic on the street", idea: "On a bright city sidewalk holding a tiny black clip microphone up near her chin like a street interview, looking straight at the camera", shot: "friend" },
      { label: "Walk and talk", idea: "Walking down a tree-lined residential street holding the phone at arm's length and talking to it, slight motion in her hair, dappled tree shadows", shot: "selfie", ownExpression: true },
    ],
  },
  {
    name: "Showing a product",
    scenes: [
      { label: "Skincare in the mirror", idea: "In a bright white bathroom holding a small frosted-glass serum bottle up beside her cheek, hair pulled over one shoulder, the label plain and blank", shot: "mirror" },
      { label: "Drink of the day", idea: "At a cafe counter holding a tall clear cup of iced matcha latte up toward the camera, the cup plain, pastries under glass behind her", shot: "friend" },
      { label: "Tech in hand", idea: "At a light wood desk holding white wireless earbuds in their open case toward the camera with both hands, the case plain, a laptop and a small plant behind", shot: "friend" },
      { label: "The unboxing", idea: "Sitting cross-legged on a white bed lifting the lid of a plain kraft delivery box with tissue paper inside, with an excited open-mouth smile", shot: "friend", ownExpression: true },
      { label: "This is my planner", idea: "At a marble cafe table holding up a closed cream linen-bound notebook with both hands beside her face, the cover blank", shot: "friend" },
      { label: "Headphones walk", idea: "Walking on a sunny park path wearing plain white over-ear headphones, one hand touching the ear cup, phone held slightly above eye level", shot: "selfie" },
    ],
  },
  {
    name: "Outfit checks",
    scenes: [
      { label: "Bedroom full-length", idea: "Full-length mirror in a bright bedroom, phone at chest height, one knee slightly bent, a small structured bag on her arm, showing the whole outfit down to her sneakers", shot: "mirror" },
      { label: "Heading out", idea: "Hallway mirror by the front door, bag on her shoulder and keys in hand, about to head out, daylight from the open door", shot: "mirror" },
      { label: "Street, full body", idea: "Full body on a quiet city sidewalk in front of a pale stone building, one hand in her pocket, looking off to the side, late sun raking across the stone", shot: "friend" },
      { label: "Gym mirror", idea: "Gym mirror with rubber flooring and a rack of dumbbells behind her, hair in a low ponytail, phone at chest height and her other hand on her hip, a big window on one side", shot: "mirror" },
    ],
  },
  {
    name: "Out and about",
    scenes: [
      { label: "Golden hour, car door", idea: "Beside the open door of a white SUV on a tree-lined street, iced coffee in one hand and a small shoulder bag on her arm, looking back over her shoulder, late-afternoon sun", shot: "friend" },
      { label: "Rooftop golden hour", idea: "Leaning on the glass railing of a rooftop terrace at golden hour, the skyline soft behind her, a breeze lifting her hair", shot: "friend" },
      { label: "Patio dinner", idea: "At a restaurant patio table before sunset, chin resting on her hand, a glass of sparkling water in front of her, low evening sun on her face", shot: "friend" },
      { label: "Rainy city", idea: "On a rainy city sidewalk under a clear umbrella, wet pavement reflecting a yellow taxi behind her, looking just past the camera", shot: "friend" },
      { label: "Travel day", idea: "In a plane window seat with her legs tucked up, holding a paper coffee cup, turning from the window back toward the camera", shot: "friend" },
      { label: "Hotel morning", idea: "Sitting up in a white hotel bed in a waffle robe, a room-service tray with a croissant, orange juice and coffee on the duvet, sheer curtains glowing behind her", shot: "friend" },
    ],
  },
  {
    name: "Seasons",
    scenes: [
      { label: "Autumn walk", idea: "Walking a park path covered in orange and yellow leaves, holding a paper coffee cup, glancing back over her shoulder, in a long coat and boots", shot: "friend" },
      { label: "First snow", idea: "On a snowy city street with light snow falling, holding a paper cup of hot chocolate near her chin with both hands, a knit beanie on, cheeks flushed from the cold", shot: "friend" },
      { label: "Cherry blossoms", idea: "Under a cherry blossom tree in full pink bloom, reaching one hand up to a low branch, petals on the path", shot: "friend" },
      { label: "Beach boardwalk", idea: "On a sunny beach boardwalk with the ocean behind her, wind in her hair, sunglasses pushed up on her head, squinting a little in the midday sun", shot: "selfie" },
    ],
  },
];

export const EXPRESSIONS = [
  "a soft closed-mouth smile",
  "a calm direct gaze",
  "a playful squint",
  "relaxed and neutral, unbothered",
  "mid-laugh with her eyes slightly closed",
  "a small amused smile, glancing just past the camera",
  "a sleepy soft smile",
  "mid-sentence, animated",
  "looking down, caught in the moment",
] as const;

export const LIGHTS = [
  "bright morning window light",
  "direct midday sun with hard shadows",
  "low warm golden-hour sun from the side",
  "soft overcast daylight",
  "open shade on a sunny day",
] as const;

/** Join the rough idea with whatever the user picked in the builder. */
export function buildIdea(parts: { idea: string; outfit?: string; expression?: string; light?: string }): string {
  const sentence = (value: string) => value.trim().replace(/[.\s]+$/, "");
  return [
    sentence(parts.idea),
    parts.outfit && `Her outfit: ${sentence(parts.outfit)}`,
    parts.expression && `Her expression: ${sentence(parts.expression)}`,
    parts.light && `The light: ${sentence(parts.light)}`,
  ]
    .filter(Boolean)
    .join(". ");
}
