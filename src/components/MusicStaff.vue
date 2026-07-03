<template>
  <div class="staff-wrapper">
    <svg
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      :class="['staff-svg', { 'staff-clickable': clickable }]"
      role="img"
      aria-label="Music staff"
      @click="handleSvgClick"
      @mousemove="handleSvgMouseMove"
      @mouseleave="hoverPos = null"
      @touchmove.prevent="handleSvgTouchMove"
      @touchend.prevent="handleSvgTouchEnd"
    >

      <!-- Staff lines (run through the clef and the full note area) -->
      <line
        v-for="i in 5"
        :key="i"
        :x1="4"
        :y1="lineY(i)"
        :x2="WIDTH - 20"
        :y2="lineY(i)"
        class="staff-line"
        stroke-width="1.5"
      />

      <!-- ── Sol clef (G on line 2) — from public/clef_de_sol.svg ── -->
      <!-- SVG is 100×125. Scale 0.753 so 85 units = 4 staff spaces.  -->
      <!-- G reference (line 2) ≈ y=82.5 in SVG coords.              -->
      <g v-if="clefBase === 'sol'" :transform="solClefTransform">
        <path d="m 52.415018,67.636287 c -1.495584,0.415795 -2.844088,1.345218 -4.094485,2.763813 -1.250428,1.443051 -1.863387,3.032853 -1.863387,4.74495 0,1.076174 0.367757,2.299101 1.078805,3.595401 0.711018,1.320759 1.789793,2.274642 3.187333,2.886104 0.465846,0.09784 0.686507,0.34242 0.686507,0.684839 0,0.122292 -0.171639,0.244586 -0.588432,0.34242 -2.231144,-0.562547 -4.069989,-1.761014 -5.49204,-3.546486 -1.422036,-1.809929 -2.157565,-3.864444 -2.206602,-6.212462 0.07352,-2.519225 0.833588,-4.867242 2.280166,-7.019591 1.471073,-2.176805 3.358955,-3.717694 5.663646,-4.622658 l -1.691748,-8.682771 c -3.775765,3.130691 -6.840497,6.383669 -9.218751,9.807862 -2.378241,3.399733 -3.604142,7.092967 -3.702202,11.079705 0.04896,1.785471 0.416793,3.522025 1.103301,5.185204 0.686492,1.687639 1.716259,3.204065 3.089258,4.5982 2.770523,2.763811 6.374665,4.206864 10.763404,4.353614 1.495599,-0.09783 3.089257,-0.366876 4.805533,-0.807128 z m 1.765297,-0.244583 3.824817,18.808592 c 3.775764,-1.516427 5.663663,-4.818326 5.663663,-9.856778 -0.22066,-1.687638 -0.711034,-3.204065 -1.544638,-4.549284 -0.809091,-1.369676 -1.887882,-2.445849 -3.26088,-3.228522 -1.373029,-0.782675 -2.917666,-1.174008 -4.682962,-1.174008 z M 49.154121,41.954853 c 0.809108,-0.48917 1.740785,-1.345219 2.746028,-2.543685 1.005241,-1.174008 1.985957,-2.568143 2.917634,-4.133488 0.956221,-1.589803 1.716276,-3.204065 2.280182,-4.842784 0.563906,-1.614261 0.833619,-3.155149 0.833619,-4.573742 0,-0.611462 -0.04896,-1.222927 -0.171638,-1.761012 -0.09808,-0.880508 -0.367773,-1.565343 -0.833604,-2.030056 -0.465863,-0.440253 -1.054294,-0.684838 -1.789824,-0.684838 -1.471073,0 -2.795033,0.904965 -3.971898,2.714894 -0.907183,1.565344 -1.667223,3.424191 -2.206632,5.527621 -0.563907,2.127891 -0.882657,4.231323 -0.931694,6.359213 0.122631,2.421393 0.514899,4.402532 1.127827,5.967877 z m -1.544622,1.418593 c -1.103316,-3.962278 -1.716259,-7.997932 -1.83886,-12.106962 0.02456,-2.641518 0.294224,-5.111828 0.809108,-7.410927 0.490358,-2.299101 1.201375,-4.280241 2.133069,-5.992335 0.907167,-1.712097 1.961446,-3.008398 3.138295,-3.888903 1.054279,-0.782673 1.814334,-1.198467 2.231144,-1.198467 0.318735,0 0.588433,0.122292 0.833603,0.342421 0.245187,0.220125 0.563922,0.587002 0.95619,1.076173 2.91765,4.133487 4.388738,9.123023 4.388738,14.944147 0,2.763813 -0.367771,5.45425 -1.103301,8.144686 -0.711033,2.665975 -1.765312,5.209662 -3.162836,7.582137 -1.422036,2.396932 -3.089259,4.475908 -5.026178,6.261379 l 1.985972,9.636653 c 1.078775,-0.122292 1.814303,-0.220127 2.231113,-0.220127 1.863356,0 3.530593,0.391335 5.07523,1.174009 1.544621,0.782672 2.868598,1.834387 3.947403,3.179605 1.078775,1.32076 1.912409,2.837186 2.500826,4.549284 0.563922,1.712094 0.882641,3.497564 0.882641,5.356412 0,2.886105 -0.760055,5.527625 -2.280165,7.900099 -1.520111,2.372475 -3.800276,4.109029 -6.865039,5.234121 0.196149,1.198467 0.539395,2.935022 1.054264,5.160746 0.490373,2.250181 0.858145,4.035653 1.103331,5.356412 0.245156,1.320761 0.343246,2.592601 0.343246,3.839991 0,1.93222 -0.465847,3.64431 -1.39754,5.16074 -0.956189,1.51643 -2.231128,2.69044 -3.849313,3.52203 -1.593689,0.83158 -3.358955,1.24738 -5.271364,1.24738 -2.696976,0 -5.050719,-0.75822 -7.061203,-2.25018 -2.010453,-1.51643 -3.089242,-3.54649 -3.187317,-6.13909 0.07352,-1.14955 0.34323,-2.22572 0.833603,-3.25298 0.490373,-1.027258 1.152338,-1.858847 2.010468,-2.494768 0.833618,-0.66038 1.838876,-1.002799 2.991214,-1.076175 0.956189,0 1.863341,0.269044 2.721502,0.782673 0.833587,0.538086 1.520094,1.247382 2.034979,2.152349 0.490341,0.904961 0.760054,1.907761 0.760054,2.983941 0,1.44305 -0.490358,2.66597 -1.471073,3.66877 -0.980731,1.0028 -2.231143,1.51643 -3.726743,1.51643 h -0.563921 c 0.956205,1.46751 2.525383,2.22573 4.707459,2.22573 1.103316,0 2.231144,-0.24459 3.358971,-0.68484 1.152337,-0.46472 2.108542,-1.07618 2.91765,-1.85885 0.809062,-0.78267 1.348488,-1.61426 1.569147,-2.49477 0.416794,-1.00279 0.612944,-2.39693 0.612944,-4.13348 0,-1.174014 -0.122632,-2.348023 -0.343246,-3.52203 -0.220676,-1.149551 -0.563906,-2.690437 -1.029783,-4.598201 -0.465816,-1.883306 -0.809062,-3.350815 -1.005212,-4.353614 -1.471088,0.366878 -2.991213,0.562545 -4.584857,0.562545 -2.672463,0 -5.197831,-0.538086 -7.576071,-1.63872 -2.37824,-1.100632 -4.462288,-2.61706 -6.276591,-4.57374 -1.789838,-1.956682 -3.187364,-4.157947 -4.19259,-6.652716 -0.980699,-2.47031 -1.495584,-5.062911 -1.52011,-7.753347 0.09807,-2.494768 0.563922,-4.891701 1.446547,-7.141885 0.88264,-2.274643 2.010483,-4.426992 3.408008,-6.432589 1.397524,-2.005597 2.844087,-3.839983 4.339687,-5.478706 1.520125,-1.614261 3.506067,-3.693233 6.006907,-6.212461 z" class="clef-svg-path" fill-rule="evenodd" />
      </g>

      <!-- ── Fa clef — from public/clef_de_fa.svg ───────────────── -->
      <!-- F ref = midpoint of two dots ≈ y=47.6 in 100×125 SVG.   -->
      <g v-else-if="clefBase === 'fa'" :transform="faClefTransform">
        <path d="m 17.907728,97.457161 c 6.147009,-4.150619 10.737803,-7.292689 13.694588,-9.464989 2.956784,-2.13349 6.069207,-4.81007 9.259412,-7.99094 3.190225,-3.18085 5.874665,-6.78841 8.053363,-10.78388 1.711813,-2.948111 3.190205,-6.361714 4.396273,-10.24081 1.206051,-3.840302 1.828534,-7.564234 1.945257,-11.094212 0,-3.297228 -0.427964,-6.439295 -1.322791,-9.387408 -0.855907,-2.986904 -2.334299,-5.430734 -4.435174,-7.409071 -2.100877,-1.939548 -4.824218,-2.909323 -8.208964,-2.909323 -3.268025,0 -6.34153,0.659448 -9.220511,1.939548 -2.840064,1.318894 -4.863139,3.413605 -5.99139,6.361718 0,0.271535 -0.15562,0.620654 -0.389041,1.124936 0.0778,0.620657 0.389041,1.086147 0.972627,1.435266 0.583565,0.349119 1.089348,0.504282 1.556192,0.504282 0.233441,0 0.894827,-0.116372 1.906355,-0.349119 1.05045,-0.232744 1.906357,-0.387907 2.60664,-0.387907 2.061977,0 3.890511,0.737026 5.563424,2.172292 1.634013,1.435263 2.451019,3.180856 2.451019,5.236776 0,1.474058 -0.427942,2.87053 -1.244948,4.150632 -0.817007,1.280102 -1.945257,2.327458 -3.384749,3.064487 -1.439489,0.775818 -3.034602,1.124936 -4.746415,1.124936 -3.112406,0 -5.757966,-0.930981 -7.936644,-2.83174 -2.139775,-1.939546 -3.229125,-4.383376 -3.229125,-7.447863 0,-3.917885 1.206071,-7.292696 3.57927,-10.163225 2.412116,-2.870532 5.446721,-5.004033 9.181612,-6.439301 3.695967,-1.474055 7.430857,-2.172292 11.243566,-2.172292 4.162832,0 8.131163,1.047356 11.827131,3.180859 3.73489,2.094711 6.652771,5.004032 8.831469,8.61159 2.178678,3.646349 3.306926,7.525443 3.306926,11.714866 0,7.447863 -2.489919,14.352652 -7.469778,20.753163 -4.979859,6.40049 -11.126845,11.9476 -18.479923,16.68011 -4.902038,3.21964 -12.838662,7.56423 -23.771006,13.033769 z M 71.94689,37.447567 c 0,-1.396472 0.505763,-2.560203 1.51729,-3.491186 0.972629,-0.969773 2.178698,-1.435264 3.61819,-1.435264 1.244948,0 2.412098,0.543071 3.462546,1.59043 1.050427,1.008561 1.556192,2.211081 1.556192,3.529975 0,1.396474 -0.544665,2.598993 -1.556192,3.568766 -1.089348,0.930984 -2.295398,1.396474 -3.657087,1.396474 -1.439472,0 -2.606643,-0.46549 -3.54035,-1.512846 -0.933727,-1.008564 -1.400589,-2.211084 -1.400589,-3.646349 z m 0,20.326456 c 0,-1.396472 0.505763,-2.598994 1.43949,-3.529975 0.972629,-0.969775 2.178677,-1.435266 3.69599,-1.435266 1.244948,0 2.373198,0.504282 3.462546,1.551638 1.011527,1.047356 1.556192,2.172292 1.556192,3.413603 0,1.512846 -0.505765,2.715368 -1.478392,3.685141 -1.011527,0.969773 -2.178677,1.474058 -3.540346,1.474058 -1.517313,0 -2.723361,-0.504285 -3.69599,-1.435266 -0.933727,-0.930984 -1.43949,-2.172292 -1.43949,-3.723933 z" class="clef-svg-path" fill-rule="evenodd" />
      </g>

      <!-- ── Do clef — from public/clef_de_do.svg ──────────────── -->
      <!-- C ref (gap between brackets) ≈ y=62.6 in 100×125 SVG.  -->
      <g v-else :transform="doClefTransform">
        <path d="M 22.297015,105.06463 V 21.953674 20.115576 h 9.62009 v 83.110944 1.83811 z m 14.46629,0 V 21.953674 20.115576 h 3.07409 v 41.627553 c 1.51896,-0.792905 3.07412,-2.414758 4.59308,-4.973682 1.55511,-2.522881 2.85709,-5.189928 3.86974,-8.037181 1.01264,-2.847254 1.55511,-4.937642 1.62745,-6.307206 0.47016,3.027457 1.22964,5.442218 2.24227,7.280318 1.04883,1.802059 2.16998,3.099542 3.47193,3.892446 1.30198,0.756865 2.56777,1.153318 3.86975,1.153318 3.21875,0 5.24404,-1.441646 6.11201,-4.360983 0.86797,-2.919333 1.30198,-6.487411 1.30198,-10.70423 0,-1.91018 -0.0362,-3.640157 -0.14469,-5.153887 -0.10851,-1.51373 -0.32547,-3.063499 -0.72328,-4.613271 -0.36169,-1.54977 -0.97651,-2.955376 -1.84448,-4.180775 -0.90414,-1.225396 -2.06144,-2.090384 -3.50808,-2.522879 -1.30198,-0.360412 -2.60393,-0.540618 -3.86974,-0.540618 -1.15732,0 -2.13378,0.216248 -2.89326,0.6127 -0.79565,0.396452 -1.22964,1.009154 -1.30196,1.729974 0.18086,0.648739 0.61482,1.405604 1.37428,2.306635 0.75948,0.864988 1.26581,1.549769 1.55513,1.982264 0.28935,0.432494 0.43398,1.045193 0.43398,1.874142 0,1.477688 -0.5063,2.703087 -1.51896,3.712241 -1.01263,1.009152 -2.35075,1.549769 -4.05055,1.549769 -1.66364,0 -3.03794,-0.612699 -4.05057,-1.802058 -1.01266,-1.225399 -1.55514,-2.667047 -1.62748,-4.288901 0.14469,-2.198511 0.94031,-4.108693 2.35078,-5.694504 1.44662,-1.549767 3.21876,-2.739127 5.35254,-3.532033 2.13377,-0.792905 4.26758,-1.189357 6.43753,-1.189357 2.45927,0 4.81003,0.432494 7.05232,1.29748 2.27844,0.864989 4.30373,2.162471 6.0397,3.820362 1.77213,1.693935 3.18258,3.748283 4.19523,6.199083 1.01264,2.414758 1.51894,5.189928 1.51894,8.25343 0,4.252859 -0.79563,7.784892 -2.35076,10.560063 -1.59128,2.811212 -3.61659,4.9016 -6.07584,6.199083 -2.49547,1.297482 -5.13555,2.018305 -7.92032,2.090387 -2.89326,-0.180198 -5.31636,-0.828947 -7.23316,-1.946222 l -3.83359,6.19908 3.83359,6.163044 c 2.64008,-1.081236 5.24404,-1.621854 7.77564,-1.621854 3.21875,0 6.00352,0.93707 8.42664,2.739129 2.38693,1.8381 4.23139,4.180777 5.4972,7.100111 1.22963,2.919336 1.8806,5.910754 1.8806,9.010293 0,3.387872 -0.75946,6.559498 -2.27844,9.478829 -1.51896,2.91934 -3.65274,5.225971 -6.40134,6.991991 -2.78476,1.72998 -5.9312,2.59497 -9.51159,2.59497 -4.15907,-0.1802 -7.631,-1.15332 -10.41577,-2.95538 -2.78477,-1.76602 -4.15904,-4.433071 -4.15904,-7.929061 0.14468,-1.693935 0.75945,-2.991418 1.84443,-3.96453 1.08497,-1.009152 2.24229,-1.51373 3.50808,-1.621854 1.51898,0 2.89328,0.540618 4.08674,1.621854 1.19347,1.045196 1.80829,2.378718 1.80829,3.96453 0,0.612699 -0.14469,1.18936 -0.43399,1.72998 -0.28932,0.50457 -0.68716,1.11727 -1.26581,1.83809 -0.57864,0.68479 -0.97646,1.18936 -1.19346,1.51373 -0.21703,0.36042 -0.39781,0.756871 -0.47016,1.261451 0,0.64874 0.39784,1.18935 1.22964,1.62185 0.79565,0.43249 1.84445,0.68478 3.11026,0.79291 3.97824,-0.1802 6.61834,-1.87415 7.95647,-5.009731 1.30198,-3.207663 1.95297,-7.136153 1.95297,-11.929629 0,-4.144733 -0.47016,-7.784892 -1.41047,-10.884433 -0.94031,-3.135584 -2.9656,-4.685353 -6.14818,-4.685353 -2.82094,0 -4.99089,1.189359 -6.50985,3.640159 -1.51896,2.414758 -2.49545,5.26201 -2.92943,8.541757 -0.47016,-2.775169 -1.19347,-5.442216 -2.24227,-8.001139 -1.04883,-2.594966 -2.2423,-4.865558 -3.65277,-6.811782 -1.33812,-1.910185 -2.82094,-3.459955 -4.3399,-4.54119 v 41.807771 z" class="clef-svg-path" fill-rule="evenodd" />
      </g>

      <!-- ── Note history (up to 3 notes, newest on the right) ─── -->
      <!--
        Each note group is translated to its x-slot.
        CSS transition on transform produces the slide-left animation.
      -->
      <template v-for="(item, idx) in displayItems" :key="item.id">
      <g
        v-if="!item.sentinel"
        :style="{
          transform: `translateX(${slotX(idx)}px)`,
          transition: 'transform 0.28s ease',
          opacity: isCurrent(idx) ? 1 : 0.45,
        }"
      >
        <!-- Ledger lines above the staff (positions are relative: x1/x2 are offsets from 0) -->
        <line
          v-for="lp in ledgerAbove(item.pos)"
          :key="`a${lp}`"
          :x1="-(NOTE_RX + 6)"
          :y1="positionToY(lp)"
          :x2="NOTE_RX + 6"
          :y2="positionToY(lp)"
          class="staff-line"
          stroke-width="1.5"
        />
        <!-- Ledger lines below the staff -->
        <line
          v-for="lp in ledgerBelow(item.pos)"
          :key="`b${lp}`"
          :x1="-(NOTE_RX + 6)"
          :y1="positionToY(lp)"
          :x2="NOTE_RX + 6"
          :y2="positionToY(lp)"
          class="staff-line"
          stroke-width="1.5"
        />
        <!-- Note head -->
        <ellipse
          cx="0"
          :cy="positionToY(item.pos)"
          :rx="NOTE_RX"
          :ry="NOTE_RY"
          :transform="`rotate(-15, 0, ${positionToY(item.pos)})`"
          :fill="noteFill(idx)"
          class="note-head"
        />
        <!-- Stem -->
        <line
          :x1="stemOffX(item.pos)"
          :y1="positionToY(item.pos)"
          :x2="stemOffX(item.pos)"
          :y2="stemEndY(item.pos)"
          :stroke="noteFill(idx)"
          stroke-width="1.8"
        />
      </g>
      </template>
      <!-- Cursor note: shown when user moves position with arrow keys -->
      <g v-if="showCursor" style="pointer-events: none;">
        <line
          v-for="lp in ledgerAbove(cursorPos)"
          :key="`cur_a${lp}`"
          :x1="GHOST_X - NOTE_RX - 6" :y1="positionToY(lp)"
          :x2="GHOST_X + NOTE_RX + 6" :y2="positionToY(lp)"
          class="staff-line" stroke-width="1.5"
        />
        <line
          v-for="lp in ledgerBelow(cursorPos)"
          :key="`cur_b${lp}`"
          :x1="GHOST_X - NOTE_RX - 6" :y1="positionToY(lp)"
          :x2="GHOST_X + NOTE_RX + 6" :y2="positionToY(lp)"
          class="staff-line" stroke-width="1.5"
        />
        <ellipse
          :cx="GHOST_X"
          :cy="positionToY(cursorPos)"
          :rx="NOTE_RX" :ry="NOTE_RY"
          :transform="`rotate(-15, ${GHOST_X}, ${positionToY(cursorPos)})`"
          fill="#f59e0b"
          opacity="0.85"
        />
        <line
          :x1="GHOST_X + stemOffX(cursorPos)"
          :y1="positionToY(cursorPos)"
          :x2="GHOST_X + stemOffX(cursorPos)"
          :y2="stemEndY(cursorPos)"
          stroke="#f59e0b" stroke-width="1.8" opacity="0.85"
        />
      </g>

      <!-- Ghost note: shown on hover when staff is clickable (ear mode) -->
      <g v-if="showGhost" style="pointer-events: none; opacity: 0.45;">
        <line
          v-for="lp in ledgerAbove(hoverPos)"
          :key="`gh_a${lp}`"
          :x1="GHOST_X - NOTE_RX - 6" :y1="positionToY(lp)"
          :x2="GHOST_X + NOTE_RX + 6" :y2="positionToY(lp)"
          class="staff-line" stroke-width="1.5"
        />
        <line
          v-for="lp in ledgerBelow(hoverPos)"
          :key="`gh_b${lp}`"
          :x1="GHOST_X - NOTE_RX - 6" :y1="positionToY(lp)"
          :x2="GHOST_X + NOTE_RX + 6" :y2="positionToY(lp)"
          class="staff-line" stroke-width="1.5"
        />
        <ellipse
          :cx="GHOST_X"
          :cy="positionToY(hoverPos)"
          :rx="NOTE_RX" :ry="NOTE_RY"
          :transform="`rotate(-15, ${GHOST_X}, ${positionToY(hoverPos)})`"
          fill="var(--primary)"
        />
        <line
          :x1="GHOST_X + stemOffX(hoverPos)"
          :y1="positionToY(hoverPos)"
          :x2="GHOST_X + stemOffX(hoverPos)"
          :y2="stemEndY(hoverPos)"
          stroke="var(--primary)" stroke-width="1.8"
        />
      </g>
    </svg>

    <!-- Feedback badge (correct / wrong flash) -->
    <transition name="feedback">
      <div v-if="feedback" :class="['feedback-badge', feedback]">
        {{ feedback === 'correct' ? '✓' : '✗' }}
      </div>
    </transition>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
	noteHistory: { type: Array, default: () => [] },
	clef: { type: String, default: "sol" },
	feedback: { type: String, default: null },
	maxHistory: { type: Number, default: 3 },
	clickable: { type: Boolean, default: false },
	cursorPos: { type: Number, default: null },
});

const emit = defineEmits(["place"]);

const WIDTH = 320;
const HEIGHT = 200;
const NOTE_RX = 10;
const NOTE_RY = 7;
const STEM_LENGTH = 45;

const STAFF_TOP_Y = 55;
const LINE_SPACING = 16;

// x positions for up to 6 note slots (oldest → … → current)
const X_SLOTS = [68, 106, 144, 182, 220, 258];

function positionToY(pos) {
	return STAFF_TOP_Y + (8 - pos) * (LINE_SPACING / 2);
}
function lineY(n) {
	return positionToY((n - 1) * 2);
}

// Total visible slots = past notes (capped by maxHistory) + 1 current
const MAX_SLOTS = 6; // hard visual maximum (X_SLOTS has 6 entries)

const displayItems = computed(() => {
	const limit = Math.min(props.maxHistory, MAX_SLOTS - 1) + 1; // past + current
	return props.noteHistory.slice(-limit);
});

// x coordinate for item at index idx within displayItems
function slotX(idx) {
	const offset = MAX_SLOTS - displayItems.value.length;
	return X_SLOTS[idx + offset];
}

// Is this the current (rightmost / active) note?
function isCurrent(idx) {
	return idx === displayItems.value.length - 1;
}

// Fill color per note slot
function noteFill(idx) {
	const item = displayItems.value[idx];
	if (item?.color) return item.color;
	if (isCurrent(idx)) {
		if (props.feedback === "correct") return "var(--success)";
		if (props.feedback === "wrong") return "var(--error)";
		return "var(--text)";
	}
	// Past notes are always correct (notes only advance on a correct answer)
	return "var(--success)";
}

// Stem: goes up (from right side of head) when note is on or below middle line
function stemOffX(pos) {
	return pos <= 4 ? NOTE_RX - 1 : -(NOTE_RX - 1);
}
function stemEndY(pos) {
	const y = positionToY(pos);
	return pos <= 4 ? y - STEM_LENGTH : y + STEM_LENGTH;
}

// Ledger lines (positions relative to note group's origin at x=0)
function ledgerAbove(pos) {
	if (pos <= 8) return [];
	const r = [];
	for (let p = 10; p <= pos; p += 2) r.push(p);
	return r;
}
function ledgerBelow(pos) {
	if (pos >= 0) return [];
	const r = [];
	for (let p = -2; p >= pos; p -= 2) r.push(p);
	return r;
}

// Ghost note (ear/placement mode)
const GHOST_X = X_SLOTS[MAX_SLOTS - 1]; // 258 — always the rightmost slot
const hoverPos = ref(null);
// Ghost = mouse hover; only when cursor (keyboard) is not also showing at same pos
const showGhost = computed(
	() => props.clickable && hoverPos.value !== null && !props.feedback,
);
// Cursor = keyboard/arrow navigation; hidden when mouse is hovering
const showCursor = computed(
	() =>
		props.cursorPos !== null &&
		props.clickable &&
		!props.feedback &&
		hoverPos.value === null,
);

function svgYToPos(event) {
	const svgEl = event.currentTarget;
	const rect = svgEl.getBoundingClientRect();
	const clientY = event.touches ? event.touches[0].clientY : event.clientY;
	const svgY = (clientY - rect.top) * (HEIGHT / rect.height);
	const pos = Math.round(8 - (svgY - STAFF_TOP_Y) / (LINE_SPACING / 2));
	return Math.max(-4, Math.min(12, pos));
}

function handleSvgClick(event) {
	if (!props.clickable) return;
	emit("place", svgYToPos(event));
	hoverPos.value = null;
}

function handleSvgMouseMove(event) {
	if (!props.clickable) {
		hoverPos.value = null;
		return;
	}
	hoverPos.value = svgYToPos(event);
}

function handleSvgTouchMove(event) {
	if (!props.clickable) return;
	hoverPos.value = svgYToPos(event);
}

function handleSvgTouchEnd() {
	if (!props.clickable || hoverPos.value === null) return;
	emit("place", hoverPos.value);
	hoverPos.value = null;
}

// Parse clef key (e.g. 'do3', 'fa4', 'sol2') into base type and staff position
const clefBase = computed(() => {
	const c = props.clef;
	if (c.startsWith("sol")) return "sol";
	if (c.startsWith("do")) return "do";
	return "fa";
});
const clefLine = computed(() => parseInt(props.clef.slice(-1)) || 2);
// Staff position of the reference line: line n → pos (n-1)*2
const clefPos = computed(() => (clefLine.value - 1) * 2);

// All three SVG files are 100×125 units.
// Scale derived from the Do clef: bars span y=20.1→105.1 (85 units) = 4 staff spaces.
// s = 4 * LINE_SPACING / 85 ≈ 0.753
const CLEF_SCALE = (4 * LINE_SPACING) / (105.115576 - 20.115576); // ≈ 0.753

// Sol clef: G reference = centre of the G-loop sub-paths.
//   Sub-path 1 top ≈ y=67.6, sub-path 2 lowest ≈ y=86.2 → centre ≈ 76.9
// Treble clefs span ~7–8 staff spaces, so use a dedicated larger scale.
// Scale chosen so the clef extends ~1.5 spaces above line 5 and ~1.5 below line 1.
//   path y-span ≈ 22–108 (86 units) ≈ 5.4 spaces at CLEF_SCALE, so boost to 1.2×.
const SOL_SCALE = 1.2;
const solClefTransform = computed(() => {
	const s = SOL_SCALE;
	const yRef = (67.636287 + 86.2) / 2; // ≈ 76.9 — centre of the G loop
	const ty = positionToY(2) - yRef * s;
	const tx = 4 - 34 * s; // leftmost path x ≈ 34 → staff x=4
	return `translate(${tx},${ty}) scale(${s})`;
});

// Fa clef: F reference = midpoint of the two dots (y≈37.4 and y≈57.8 → mid ≈ 47.6)
const faClefTransform = computed(() => {
	const s = CLEF_SCALE;
	const yRef = (37.447567 + 57.774023) / 2;
	const ty = positionToY(clefPos.value) - yRef * s;
	const tx = 4 - 17.907728 * s; // left edge of hook body → staff x=4
	return `translate(${tx},${ty}) scale(${s})`;
});

// Do clef: C reference = midpoint of vertical bars = y≈62.6
const doClefTransform = computed(() => {
	const s = CLEF_SCALE;
	const yRef = (20.115576 + 105.115576) / 2;
	const ty = positionToY(clefPos.value) - yRef * s;
	const tx = 4 - 22.297015 * s; // left edge of first bar → staff x=4
	return `translate(${tx},${ty}) scale(${s})`;
});
</script>

<style scoped>
.staff-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.staff-svg {
  width: 100%;
  max-width: 420px;
  height: auto;
  background: var(--surface);
  border-radius: 12px;
}

.staff-line  { stroke: var(--border); }
.clef-shape    { fill: var(--text-muted); stroke: var(--text-muted); }
/* Paths from SVG files are filled shapes — stroke would double the weight */
.clef-svg-path { fill: var(--text-muted); stroke: none; }

.note-head { transition: fill 0.15s ease; }
.staff-clickable { cursor: crosshair; }

.feedback-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  font-weight: 700;
  color: white;
}
.feedback-badge.correct { background: var(--success); }
.feedback-badge.wrong   { background: var(--error); }

.feedback-enter-active, .feedback-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.feedback-enter-from, .feedback-leave-to {
  opacity: 0;
  transform: scale(0.6);
}
</style>
