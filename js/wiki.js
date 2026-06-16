'use strict';
/* ============ Guía autogenerada ============
   Esta página se construye sola a partir de config.js y assets.js:
   los sprites son los mismos que dibuja el juego, así que la wiki
   nunca se queda desactualizada. */

buildAssets();

const FLAVOR = {
  // objetos del mundo
  [O.TREE]: 'El pilar de toda civilización. Algunos dan fruta; todos dan madera.',
  [O.PINE]: 'Crece en la tundra, con la copa siempre nevada.',
  [O.CACTUS]: 'Mejor córtalo con espada. Mejor aún: no lo abraces.',
  [O.ROCK]: 'Con un pico rinde el triple. A puñetazos, también sale… pero duele verlo.',
  [O.BUSH]: 'Bayas gratis. El picoteo oficial de toda aventurera.',
  // construcciones
  [O.HUT]: 'Tu hogar: al colocarla, reaparecerás junto a su puerta.',
  [O.TOWER]: 'Vigila y dispara sola a cualquier monstruo que se acerque. También al Coloso.',
  [O.SAWMILL]: 'Corta madera mientras tú vives aventuras. Recógela con clic derecho.',
  [O.QUARRY]: 'Pica piedra día y noche sin quejarse.',
  [O.FARM]: 'Bayas cultivadas con mimo. La merienda nunca se acaba.',
  [O.BRAZIER]: 'Un faro contra la noche: el círculo de luz más grande que existe.',
  [O.ALTAR]: 'Runas que laten en la oscuridad. Actívalo… si estás preparada.',
  // criaturas
  slime: 'Salta hacia ti sin malicia y sin descanso. La puerta de entrada al combate.',
  shadow: 'Camina sin pausa con un vaivén inquietante. El sol las deshace; su esencia invoca cosas peores.',
  bat: 'Ignora tus muros y baja en picado. Las torres lo bajan a él.',
};

const $ = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
};

function img(canvas, scale) {
  const i = document.createElement('img');
  i.src = canvas.toDataURL();
  i.width = canvas.width * (scale || 2);
  i.alt = '';
  return i;
}

function costText(cost) {
  return Object.entries(cost).map(([id, n]) => n + '× ' + ITEMS[id].name).join(' · ');
}

function dropsText(drops) {
  return drops.map(d => d[1] + '× ' + ITEMS[d[0]].name + (d[2] < 1 ? ' (' + Math.round(d[2] * 100) + '%)' : '')).join(' · ');
}

function card(sprite, scale, title, metaLines, flavor) {
  const c = $('<div class="card"></div>');
  if (sprite) c.appendChild(img(sprite, scale));
  const body = $('<div class="body"></div>');
  body.appendChild($('<div class="title">' + title + '</div>'));
  for (const m of metaLines) body.appendChild($('<div class="meta">' + m + '</div>'));
  if (flavor) body.appendChild($('<div class="flavor">' + flavor + '</div>'));
  c.appendChild(body);
  return c;
}

function section(root, id, title) {
  root.appendChild($('<h2 id="' + id + '">' + title + '</h2>'));
}

function build() {
  const root = document.getElementById('wiki');
  root.innerHTML = '';
  root.appendChild($('<h1>Guía de PixelRealm</h1>'));
  root.appendChild($('<p class="sub">Generada automáticamente desde los datos del juego — siempre al día.</p>'));
  root.appendChild($(`<nav>
    <a href="#biomas">Biomas</a><a href="#recursos">Recursos</a><a href="#recetas">Fabricación</a>
    <a href="#construcciones">Construcciones</a><a href="#criaturas">Criaturas</a><a href="#aldeas">Aldeas</a>
    <a href="#mundo">El mundo</a><a href="#multi">Jugar juntos</a><a href="#controles">Controles</a>
  </nav>`));

  /* ---- biomas ---- */
  section(root, 'biomas', '🌍 Biomas');
  const tiles = $('<div class="tiles"></div>');
  const biomes = [
    [T.GRASS, 'Pradera'], [T.GRASS, 'Bosque'], [T.SAND, 'Playa / Desierto'],
    [T.SNOW, 'Tundra'], [T.STONE, 'Montaña'], [T.WATER, 'Agua'], [T.DEEP, 'Mar profundo'],
  ];
  for (const [t, name] of biomes) {
    const d = $('<div class="tile"></div>');
    d.appendChild(img(Assets.tiles[t][0], 1.5));
    d.appendChild(document.createTextNode(name));
    tiles.appendChild(d);
  }
  root.appendChild(tiles);
  root.appendChild($('<p class="meta" style="margin-top:12px">El mundo es infinito y se genera con ruido determinista: la misma semilla crea siempre el mismo mundo. Los bosques densos concentran árboles y bayas; el desierto esconde cactus; la tundra, pinos nevados. El agua poco profunda se puede vadear (despacio); el mar profundo, no.</p>'));

  /* ---- recursos ---- */
  section(root, 'recursos', '🎒 Recursos');
  const HOW = {
    wood: 'Talando árboles y pinos (con hacha más rápido)', stone: 'Picando rocas (con pico más rápido)',
    fiber: 'Hierba alta, flores y cactus', berry: 'Arbustos, huertos y cultivos — clic der. para comer (+2 ❤)',
    seeds: 'Hierba alta y arbustos; se plantan en tierra arada', coin: 'Vendiendo a los comerciantes',
    coal: 'Vetas de carbón en las montañas', iron_ore: 'Vetas de hierro en las montañas',
    iron: 'Fundiendo mineral de hierro en un horno (gasta carbón)',
    slime: 'Sueltan las babas al caer', essence: 'Sueltan las sombras al caer',
    crown: 'El trofeo del jefe (retirado por ahora).',
  };
  let grid = $('<div class="cards"></div>');
  for (const id of ['wood', 'stone', 'coal', 'iron_ore', 'iron', 'fiber', 'berry', 'seeds', 'coin', 'slime', 'essence']) {
    grid.appendChild(card(Assets.items[id], 3, ITEMS[id].name, ['<b>Se consigue:</b> ' + HOW[id]], null));
  }
  root.appendChild(grid);

  /* ---- recetas ---- */
  section(root, 'recetas', '🛠 Fabricación (tecla E)');
  const tbl = $('<table class="wt"><tr><th></th><th>Objeto</th><th>Cuesta</th><th>Notas</th></tr></table>');
  for (const r of RECIPES.filter(r => r.cat !== 'build')) {
    const item = ITEMS[r.out];
    const notes = item.tool ? 'Herramienta · daño ' + item.dmg + (item.tool === 'axe' ? ' · tala ×3' : item.tool === 'pick' ? ' · pica ×3' : ' · arma')
      : (item.place != null && OBJ[item.place].light ? 'Ilumina (radio ' + OBJ[item.place].light + ')' : (item.place != null ? 'Se coloca en el mundo' : ''));
    const row = $('<tr><td></td><td>' + item.name + (r.n > 1 ? ' ×' + r.n : '') + '</td><td>' + costText(r.cost) + '</td><td>' + notes + '</td></tr>');
    row.firstChild.appendChild(img(Assets.items[r.out], 2));
    tbl.appendChild(row);
  }
  root.appendChild(tbl);

  /* ---- construcciones ---- */
  section(root, 'construcciones', '🏰 Construcciones');
  grid = $('<div class="cards"></div>');
  for (const r of RECIPES.filter(r => r.cat === 'build')) {
    const oid = ITEMS[r.out].place;
    const def = OBJ[oid];
    let spr = Assets.obj[oid];
    if (Array.isArray(spr)) spr = spr[0];
    const meta = ['<b>Cuesta:</b> ' + costText(r.cost), '<b>Tamaño:</b> ' + (def.size || 1) + '×' + (def.size || 1) + ' · <b>Resistencia:</b> ' + def.hp];
    if (def.prod) meta.push('<b>Produce:</b> 1× ' + ITEMS[def.prod.item].name + ' cada ' + def.prod.per + 's (almacena ' + def.prod.cap + ')');
    if (def.tower) meta.push('<b>Dispara:</b> cada ' + def.tower.rate + 's · daño ' + def.tower.dmg + ' · alcance ' + def.tower.range);
    if (def.light) meta.push('<b>Luz:</b> radio ' + def.light);
    grid.appendChild(card(spr, 1, def.name, meta, FLAVOR[oid]));
  }
  root.appendChild(grid);
  root.appendChild($('<p class="meta" style="margin-top:12px">Se fabrican en la pestaña «Construcciones» del panel (E) y se colocan con clic derecho. Para demolerlas, golpéalas — recuperas parte del material. <b>Online, solo su dueño puede demolerlas; usarlas puede todo el mundo.</b></p>'));

  /* ---- criaturas ---- */
  section(root, 'criaturas', '🌙 Criaturas de la noche');
  grid = $('<div class="cards"></div>');
  const MOBSPR = { slime: Assets.mobs.slime[0], shadow: Assets.mobs.shadow[0], bat: Assets.mobs.bat[0] };
  for (const k in MOBS) {
    const m = MOBS[k];
    grid.appendChild(card(MOBSPR[k], 1.5, m.name,
      ['<b>Vida:</b> ' + m.hp + ' · <b>Daño:</b> ' + m.dmg, '<b>Suelta:</b> ' + dropsText(m.drops)],
      FLAVOR[k]));
  }
  root.appendChild(grid);
  root.appendChild($('<p class="meta" style="margin-top:12px">Aparecen al caer la noche y se desvanecen con el sol. Las sombras arden al amanecer; los murciélagos vuelan por encima de cualquier muro, así que una torre arquera nunca sobra.</p>'));

  /* ---- aldeas y comerciantes ---- */
  section(root, 'aldeas', '🏘 Aldeas y comerciantes');
  grid = $('<div class="cards"></div>');
  for (let i = 0; i < NPC_ROLES.length; i++) {
    const r = NPC_ROLES[i];
    const look = clampLook({ skin: 1, hair: r.hair, style: 0, shirt: r.shirt, pants: 1 });
    const portrait = getHeroLookSet(look).down[0];
    const meta = [];
    if (r.sells.length) meta.push('<b>Vende:</b> ' + r.sells.map(([it, p]) => ITEMS[it].name + ' (' + p + '◉)').join(', '));
    if (r.buys.length) meta.push('<b>Compra:</b> ' + r.buys.map(([it, p]) => ITEMS[it].name + ' (' + p + '◉)').join(', '));
    grid.appendChild(card(portrait, 1, r.title, meta, r.lines[0]));
  }
  root.appendChild(grid);
  root.appendChild($('<p class="meta" style="margin-top:12px">Explora hasta dar con una <b>aldea</b> (casas, plaza, pozo y faroles): una <b>brújula ⚑</b> te guía a la más cercana y el minimapa la marca. Haz clic en un comerciante para acercarte y hablar: charla libremente, pulsa <b>⚖</b> para comerciar con monedas, o acepta un <b>recado</b> (tráele materiales a cambio de oro y, a veces, una herramienta). Vende babas, esencia o madera para conseguir oro. Si el servidor tiene un modelo de IA conectado (Gemma), los comerciantes responden con conversación real; si no, con diálogo procedural.</p>'));

  /* ---- granja y mineria ---- */
  section(root, 'oficios', '🌾 Granja y minería');
  root.appendChild($('<p class="meta">· <b>Granja:</b> fabrica una azada para arar hierba o tierra; planta semillas (que sueltan la hierba alta y los arbustos) en la tierra arada y, tras cuatro fases de crecimiento, cosecha bayas y más semillas.<br>· <b>Minería:</b> en las montañas hay vetas de <b>carbón</b> y <b>hierro</b>. Pícalas con el pico, construye un <b>horno</b> y haz clic en él para fundir el mineral (gasta carbón) en lingotes.<br>· Con lingotes de hierro fabricas hacha, pico y espada de hierro: más daño y recolección más rápida que las de madera.</p>'));

  /* ---- mundo ---- */
  section(root, 'mundo', '🗺 Secretos del mundo');
  root.appendChild($('<p class="meta">· El día completo dura ' + (CFG.DAY_LENGTH / 60) + ' minutos; la noche cerrada, aproximadamente un tercio.<br>· Si llevas un rato sin recibir daño, regeneras vida poco a poco. Junto a una hoguera y en compañía, el doble.<br>· Exploradores atentos hablan de <b>ruinas antiguas</b>: anillos de muros derruidos con losas agrietadas y una antorcha que nunca se apaga. Nadie sabe quién la enciende.<br>· Las antorchas y fogatas mantienen a raya la oscuridad; el brasero es el rey de la noche.</p>'));

  /* ---- cielo y clima ---- */
  section(root, 'clima', '🌦 Cielo y clima');
  root.appendChild($('<p class="meta">· El mundo se dibuja como una <b>maqueta iluminada</b>: luz nítida en HD, oclusión de contacto, sombras que siguen al sol, fuegos y agua que irradian con <i>bloom</i>, y un <i>tilt-shift</i> que enfoca a tu alrededor.<br>· El <b>cielo cambia de color</b> con la hora: amanecer dorado, mediodía neutro, atardecer ámbar, anochecer violáceo y noche azul con estrellas titilantes.<br>· La vegetación se <b>mece con el viento</b>; de día flotan motas a contraluz y de noche vagan luciérnagas. De los fuegos y antorchas suben ascuas.<br>· A veces <b>llueve</b>, se desata una <b>tormenta</b> con relámpagos y truenos, o <b>nieva</b> en los biomas fríos (tundra y alta montaña).<br>· La lluvia encapota el cielo, arrecia el viento y <b>riega tus cultivos</b>: crecen más rápido mientras llueve.</p>'));

  /* ---- multijugador ---- */
  section(root, 'multi', '🤝 Jugar juntos');
  root.appendChild($('<p class="meta">El mundo compartido es <b>cooperativo, sin PvP</b>: nadie puede destruir lo que construyas, pero cualquiera puede usarlo — recoger tu huerto, refugiarse tras tus muros, calentarse en tu fogata. Habla con la tecla <b>T</b>; si estás cerca, tu bocadillo aparece sobre tu cabeza. Personaliza tu héroe desde la pantalla de título para que te reconozcan.</p>'));

  /* ---- controles ---- */
  section(root, 'controles', '⌨ Controles');
  root.appendChild($(`<table class="wt">
    <tr><td>Clic izquierdo</td><td>Ir ahí · talar/picar · atacar · hablar con comerciantes</td></tr>
    <tr><td>Clic izq. (mantener)</td><td>Arrastrar para moverte</td></tr>
    <tr><td>Clic derecho</td><td>Colocar · comer · recoger producción</td></tr>
    <tr><td>WASD / Flechas</td><td>Moverse a mano (alternativa)</td></tr>
    <tr><td>1–9 / Rueda</td><td>Barra rápida</td></tr>
    <tr><td>E</td><td>Inventario, fabricación y construcciones</td></tr>
    <tr><td>T</td><td>Chat (online)</td></tr>
    <tr><td>+ / −</td><td>Zoom de cámara</td></tr>
    <tr><td>H</td><td>Ayuda · M — silenciar</td></tr>
  </table>`));
}

build();
